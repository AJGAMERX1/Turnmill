import {
  cast,
  getOC,
  measureVolume,
  type Shape3D,
  type ShapeMesh,
  type Solid,
} from "replicad";
import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";
import type { Body } from "./geometry";

function checkImportedSolid(shape: Shape3D) {
  const check = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true);
  try {
    if (!check.IsValid() || !(measureVolume(shape) > 0)) {
      throw new Error(
        "The file contains a damaged or zero-volume body. Repair the solid in the source model and import it again.",
      );
    }
  } finally {
    check.delete();
  }
}

function readStep(path: string): Shape3D[] {
  const oc = getOC();
  const reader = new oc.STEPControl_Reader();
  try {
    if (
      reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone ||
      !reader.TransferRoots()
    ) {
      throw new Error(
        "The STEP reader found no transferable geometry. Check the file in the source CAD application.",
      );
    }
    const root = reader.OneShape();
    try {
      if (root.IsNull()) throw new Error("The STEP file is empty.");
      const freeFaces = new oc.TopExp_Explorer(
        root,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID,
      );
      try {
        if (freeFaces.More())
          throw new Error(
            "This STEP contains sheet surfaces. Export closed solids from the source application.",
          );
      } finally {
        freeFaces.delete();
      }
      const shape = cast(root);
      try {
        const solids = shape.solids;
        if (!solids.length)
          throw new Error("The STEP file contains no closed solids.");
        return solids;
      } finally {
        shape.delete();
      }
    } finally {
      root.delete();
    }
  } finally {
    reader.delete();
  }
}

/** Reconstruct cavity shells as cuts, including material islands inside a cavity. */
function assembleShells(shellSolids: Solid[]): Shape3D[] {
  if (shellSolids.length < 2) return shellSolids.map((s) => s.clone());
  const shells = shellSolids
    .map((shape) => {
      const box = shape.boundingBox;
      try {
        return {
          shape,
          bounds: box.bounds,
          volume: measureVolume(shape),
          parent: -1,
          depth: 0,
        };
      } finally {
        box.delete();
      }
    })
    .sort((a, b) => b.volume - a.volume);

  for (let i = 1; i < shells.length; i++) {
    const inner = shells[i];
    for (let j = i - 1; j >= 0; j--) {
      const outer = shells[j],
        [min, max] = outer.bounds;
      const withinBounds = min.every(
        (v, k) =>
          inner.bounds[0][k] >= v - 1e-6 && inner.bounds[1][k] <= max[k] + 1e-6,
      );
      if (!withinBounds) continue;
      const common = outer.shape.intersect(inner.shape);
      try {
        if (
          Math.abs(measureVolume(common) - inner.volume) <=
          Math.max(1e-12, inner.volume * 1e-7)
        ) {
          inner.parent = j;
          inner.depth = outer.depth + 1;
          break;
        }
      } finally {
        common.delete();
      }
    }
  }
  const materials: Shape3D[] = [];
  try {
    for (const [i, shell] of shells.entries()) {
      if (shell.depth % 2) continue;
      let material: Shape3D = shell.shape.clone();
      try {
        for (const cavity of shells.filter((child) => child.parent === i)) {
          const cut = material.cut(cavity.shape);
          material.delete();
          material = cut;
        }
        materials.push(material);
      } catch (error) {
        material.delete();
        throw error;
      }
    }
    return materials;
  } catch (error) {
    materials.forEach((shape) => shape.delete());
    throw error;
  }
}

function readStl(path: string): Shape3D[] {
  const oc = getOC();
  const reader = new oc.StlAPI_Reader();
  const triangles = new oc.TopoDS_Shape();
  const sewing = new oc.BRepBuilderAPI_Sewing(1e-7, true, true, true, false);
  const shells: Solid[] = [];
  try {
    if (!reader.Read(triangles, path) || triangles.IsNull())
      throw new Error("The STL reader found no triangles.");
    sewing.Add(triangles);
    sewing.Perform();
    if (sewing.NbFreeEdges() || sewing.NbMultipleEdges()) {
      throw new Error(
        "This STL has open or non-manifold edges. Repair the mesh into a watertight shell before importing.",
      );
    }
    const stitched = sewing.SewedShape();
    try {
      const explorer = new oc.TopExp_Explorer(
        stitched,
        oc.TopAbs_ShapeEnum.TopAbs_SHELL,
      );
      const fixer = new oc.ShapeFix_Solid();
      try {
        while (explorer.More()) {
          const item = explorer.Current();
          const shell = oc.TopoDS.Shell(item);
          try {
            const raw = fixer.SolidFromShell(shell);
            try {
              shells.push(cast(raw) as Solid);
            } finally {
              raw.delete();
            }
          } finally {
            shell.delete();
            item.delete();
          }
          explorer.Next();
        }
      } finally {
        explorer.delete();
        fixer.delete();
      }
    } finally {
      stitched.delete();
    }
    if (!shells.length)
      throw new Error("No closed shell could be built from the STL triangles.");
    return assembleShells(shells);
  } finally {
    shells.forEach((s) => s.delete());
    sewing.delete();
    triangles.delete();
    reader.delete();
  }
}

/** Call in a worker with initialized OpenCascade. The caller owns the returned bodies. */
export async function importSolidFile(
  format: "step" | "stl",
  file: Blob,
  name: string,
  stlUnit: "mm" | "in" = "mm",
): Promise<Body[]> {
  const oc = getOC();
  const path = "/import-" + crypto.randomUUID() + "." + format;
  oc.FS.writeFile(path, new Uint8Array(await file.arrayBuffer()));
  try {
    const shapes = format === "step" ? readStep(path) : readStl(path);
    try {
      for (let i = 0; i < shapes.length; i++) {
        if (format === "stl" && stlUnit === "in")
          shapes[i] = shapes[i].scale(25.4);
        checkImportedSolid(shapes[i]);
      }
      return shapes.map((shape, index) => ({
        shape,
        name: shapes.length === 1 ? name : name + " · " + (index + 1),
      }));
    } catch (error) {
      shapes.forEach((shape) => shape.delete());
      throw error;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message &&
      !/BindingError|wasm|TopoDS|Aborted/i.test(error.message)
    )
      throw error;
    throw new Error(
      "The " +
        format.toUpperCase() +
        " file could not be converted to closed solids. Check the file for damaged geometry.",
    );
  } finally {
    oc.FS.unlink(path);
  }
}

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
const contentTypes =
  xmlHeader +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
const relationships =
  xmlHeader +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
function xmlName(name: string) {
  return name
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** OC triangulates each face separately. Weld the matching face-boundary vertices into a 3MF object mesh. */
function meshXml(mesh: ShapeMesh) {
  const vertexIds = new Map<string, number>();
  const vertexXml: string[] = [],
    triangleXml: string[] = [];
  const index = new Uint32Array(mesh.vertices.length / 3);
  for (let i = 0; i < index.length; i++) {
    const xyz = mesh.vertices.slice(3 * i, 3 * i + 3);
    if (!xyz.every(Number.isFinite))
      throw new Error("A mesh has invalid vertex coordinates.");
    const key = xyz.map((v) => Math.round(v * 1e7)).join(",");
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertexXml.length;
      vertexIds.set(key, id);
      vertexXml.push(
        '<vertex x="' + xyz[0] + '" y="' + xyz[1] + '" z="' + xyz[2] + '"/>',
      );
    }
    index[i] = id;
  }
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const a = index[mesh.triangles[i]],
      b = index[mesh.triangles[i + 1]],
      c = index[mesh.triangles[i + 2]];
    if (a !== b && b !== c && c !== a)
      triangleXml.push(
        '<triangle v1="' + a + '" v2="' + b + '" v3="' + c + '"/>',
      );
  }
  if (!triangleXml.length)
    throw new Error("A body has no printable triangles.");
  return (
    "<mesh><vertices>" +
    vertexXml.join("") +
    "</vertices><triangles>" +
    triangleXml.join("") +
    "</triangles></mesh>"
  );
}

export function export3MF(bodies: Body[]): Blob {
  if (!bodies.length) throw new Error("Add a solid feature before exporting.");
  const objects = bodies.map(({ name, shape }, index) => {
    const mesh = shape.mesh({ tolerance: 0.005, angularTolerance: 0.08 });
    return (
      '<object id="' +
      (index + 1) +
      '" type="model" name="' +
      xmlName(name) +
      '">' +
      meshXml(mesh) +
      "</object>"
    );
  });
  const build = bodies
    .map((_, i) => '<item objectid="' + (i + 1) + '"/>')
    .join("");
  const model =
    xmlHeader +
    '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter" xml:lang="en-US"><resources>' +
    objects.join("") +
    "</resources><build>" +
    build +
    "</build></model>";
  const archive = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(relationships),
    "3D/3dmodel.model": strToU8(model),
  });
  return new Blob([new Uint8Array(archive).buffer], { type: "model/3mf" });
}
