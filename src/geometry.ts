import { cutScale } from "./secondaryScaleCut";
import { applyAdvanced } from "./advanced";
import {
  assembleWire,
  basicFaceExtrusion,
  deserializeShape,
  exportSTEP,
  getOC,
  isShape3D,
  makeFace,
  makeLine,
  makePolygon,
  makeThreePointArc,
  measureShapeSurfaceProperties,
  measureShapeVolumeProperties,
  revolution,
  Vector,
  type AnyShape,
  type Edge,
  type Shape3D,
} from "replicad";
import { binarySTL, printableMesh } from "./printMesh";
import { export3MF } from "./exchangeSolids";
import { applyFinish } from "./finishing";
import type { EvaluatedFeature } from "./types";

const ORIGIN: [number, number, number] = [0, 0, 0];
const LINEAR_TOLERANCE = 1e-7;
const DISPLAY_MESH = { tolerance: 0.015, angularTolerance: 0.12 };

export type Body = {
  name: string;
  shape: Shape3D;
  guides?: Float32Array[];
  threadFrames?: import("./threadMates").ThreadFrame[];
};
export type RenderBody = {
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  edges: Float32Array;
  guides?: Float32Array;
  faces: { start: number; count: number; faceId: number }[];
};

export function cloneBody(body: Body): Body {
  return {
    ...body,
    shape: body.shape.clone(),
    guides: body.guides?.slice(),
    threadFrames: body.threadFrames?.slice(),
  };
}

export function releaseBodies(bodies: Body[]) {
  bodies.forEach(({ shape }) => shape.delete());
}

function checkShape(shape: AnyShape, message: string) {
  const checker = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true);
  try {
    if (!checker.IsValid()) throw new Error(message);
  } finally {
    checker.delete();
  }
}

function sketchFace(feature: EvaluatedFeature) {
  if (!feature.edges?.length)
    return makePolygon(feature.points.map(([x, y]) => [x, y, 0]));
  const to3d = (p: { x: number; y: number }): [number, number, number] => [
    p.x,
    p.y,
    0,
  ];
  const curves: Edge[] = [];
  try {
    for (const { start, end, through } of feature.edges) {
      curves.push(
        through
          ? makeThreePointArc(to3d(start), to3d(through), to3d(end))
          : makeLine(to3d(start), to3d(end)),
      );
    }
    const wire = assembleWire(curves);
    try {
      return makeFace(wire);
    } finally {
      wire.delete();
    }
  } finally {
    curves.forEach((edge) => edge.delete());
  }
}

function featureTool(feature: EvaluatedFeature): Shape3D {
  const { points, kind, amount } = feature;
  if (kind === "import") {
    if (!feature.brep)
      throw Error(
        "The imported body is missing its geometry. Reimport the source file.",
      );
    const shape = deserializeShape(feature.brep);
    if (isShape3D(shape)) return shape;
    shape.delete();
    throw Error("The import must contain a closed solid.");
  }
  if (
    points.length < 3 &&
    !(feature.edges?.some((edge) => edge.through) && feature.edges.length >= 2)
  )
    throw new Error("Close a profile with at least three corners.");
  if (!Number.isFinite(amount) || Math.abs(amount) < LINEAR_TOLERANCE)
    throw new Error(
      `Enter a nonzero ${kind === "revolve" ? "angle" : "extrusion distance"}.`,
    );
  if (kind === "revolve" && Math.abs(amount) > 360)
    throw new Error("Choose an angle of one full turn (360°) or less.");
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))
    throw new Error("Give every sketch corner a valid X and Y dimension.");
  if (
    kind === "revolve" &&
    points.some(([, y]) => y < -LINEAR_TOLERANCE) &&
    points.some(([, y]) => y > LINEAR_TOLERANCE)
  )
    throw new Error(
      "Keep the turning profile on one side of the X axis. Its outline can touch the axis.",
    );
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i],
      [nx, ny] = points[(i + 1) % points.length];
    if (Math.hypot(nx - x, ny - y) < LINEAR_TOLERANCE)
      throw new Error(
        `Corners ${i + 1} and ${((i + 1) % points.length) + 1} touch. Remove the duplicate corner.`,
      );
  }
  const face = sketchFace(feature);
  try {
    checkShape(
      face,
      "This sketch crosses or touches itself. Separate the crossing edges to make a closed outline.",
    );
    if (kind === "revolve") return revolution(face, ORIGIN, [1, 0, 0], amount);
    const vector = new Vector([0, 0, amount]);
    try {
      return basicFaceExtrusion(face, vector);
    } finally {
      vector.delete();
    }
  } finally {
    face.delete();
  }
}

function volume(shape: Shape3D) {
  const properties = measureShapeVolumeProperties(shape);
  try {
    return properties.volume;
  } finally {
    properties.delete();
  }
}

function checkSolid(shape: Shape3D) {
  checkShape(
    shape,
    "The result has an invalid edge or face. Adjust the profile or operation so it makes a closed solid.",
  );
  const solids = shape.solids;
  try {
    if (solids.length !== 1)
      throw new Error(
        "The operation must produce one connected body. Adjust the profile, or use New body for a separate part.",
      );
  } finally {
    solids.forEach((solid) => solid.delete());
  }
  if (!(volume(shape) > 0))
    throw new Error(
      "The result has no volume. Give the profile an enclosed area and a nonzero depth.",
    );
}

/** New starts a body. An Add or Cut acts on the most recently started body. */
export function buildBodies(
  features: EvaluatedFeature[],
  prefix?: { id: string; body: Body },
): Body[] {
  const bodies: Body[] = prefix ? [cloneBody(prefix.body)] : [];
  let bodyId = prefix?.id ?? "";
  try {
    for (const feature of features) {
      let tool: Shape3D | undefined, result: Shape3D | undefined;
      try {
        if (feature.ruler?.placement) {
          if (!bodies.length)
            throw Error(
              "Restore the target part before these graduations in feature history.",
            );
        } else {
          tool = featureTool(feature);
          checkSolid(tool);
        }
        if (tool && feature.operation === "new") {
          bodyId = feature.id;
          bodies.push({ name: feature.name, shape: tool });
          tool = undefined;
        } else if (tool) {
          const body = bodies.at(-1);
          if (!body)
            throw new Error(
              "Add a New body earlier in the timeline, or set this operation to New body.",
            );
          const oldVolume = volume(body.shape);
          result =
            feature.operation === "cut"
              ? body.shape.cut(tool)
              : body.shape.fuse(tool);
          checkSolid(result);
          const change = volume(result) - oldVolume;
          if (Math.abs(change) <= Math.max(1e-12, oldVolume * 1e-12))
            throw new Error(
              feature.operation === "cut"
                ? "The cutter misses the material. Move the profile or increase the cut distance."
                : "The added volume is already inside the body. Move or resize the profile.",
            );
          body.shape.delete();
          body.shape = result;
          result = undefined;
        }
        const body = bodies.at(-1)!;
        if (feature.ruler) {
          result = cutScale(body.shape, feature.ruler, feature.amount);
          checkSolid(result);
          body.shape.delete();
          body.shape = result;
          result = undefined;
        }
        for (const finish of feature.finishes ?? []) {
          if (finish.suppressed) continue;
          try {
            const finished = applyFinish(
              body.shape,
              feature.kind === "import" ? "extrude" : feature.kind,
              finish,
            );
            try {
              checkSolid(finished.shape);
            } catch (error) {
              finished.shape.delete();
              throw error;
            }
            body.shape.delete();
            body.shape = finished.shape;
            if (finished.guides) (body.guides ??= []).push(finished.guides);
            if (finished.thread)
              (body.threadFrames ??= []).push({
                ...finished.thread,
                bodyId,
                featureId: feature.id,
              });
          } catch (error) {
            const message =
              error instanceof Error &&
              !/BRep|StdFail|Standard_|wasm/i.test(error.message)
                ? error.message
                : "Reduce the size, check the selected end, or choose a different rim.";
            throw Error(finish.name + " — " + message);
          }
        }
        for (const operation of feature.operations ??
          (feature.advanced ? [feature.advanced] : [])) {
          const next = applyAdvanced(body.shape, operation);
          try {
            checkShape(
              next,
              "The advanced operation produced an invalid solid. Adjust its dimensions or selected faces.",
            );
            if (!(volume(next) > 0))
              throw Error(
                "This operation left no material. Adjust the feature.",
              );
          } catch (e) {
            next.delete();
            throw e;
          }
          body.shape.delete();
          body.shape = next;
          body.guides = [];
          // A transform or replacement can remove or duplicate the original thread axis.
          if (operation.kind !== "shell") body.threadFrames = [];
        }
      } catch (error) {
        const detail =
          error instanceof Error &&
          !/wasm|Unbound|BindingError|abort|std::|TopoDS|BRep|Standard_/i.test(
            error.message,
          )
            ? error.message
            : "The geometry kernel could not build this shape. Check for crossing edges, a collapsed profile, or surfaces that only touch.";
        throw new Error(`${feature.name} — ${detail}`);
      } finally {
        tool?.delete();
        result?.delete();
      }
    }
    return bodies;
  } catch (error) {
    releaseBodies(bodies);
    throw error;
  }
}

export function displayBodies(bodies: Body[]) {
  const bodyProperties: import("./materials").BodyProps[] = [];
  let totalVolume = 0,
    totalArea = 0;
  const moment: [number, number, number] = [0, 0, 0];
  const meshes = bodies.map(({ shape, guides }): RenderBody => {
    const { vertices, normals, triangles, faceGroups } =
      shape.mesh(DISPLAY_MESH);
    const { lines } = shape.meshEdges(DISPLAY_MESH);
    const mass = measureShapeVolumeProperties(shape);
    try {
      const centroid = mass.centerOfMass,
        weight = mass.volume;
      bodyProperties.push({ volume: weight, center: centroid });
      totalVolume += weight;
      for (let i = 0; i < 3; i++) moment[i] += centroid[i] * weight;
    } finally {
      mass.delete();
    }
    const properties = measureShapeSurfaceProperties(shape);
    try {
      totalArea += properties.area;
    } finally {
      properties.delete();
    }
    return {
      vertices: Float32Array.from(vertices),
      normals: Float32Array.from(normals),
      triangles: Uint32Array.from(triangles),
      edges: Float32Array.from(lines),
      guides: guides?.length
        ? Float32Array.from(guides.flatMap((guide) => Array.from(guide)))
        : undefined,
      faces: faceGroups,
    };
  });
  const center =
    totalVolume > 0
      ? (moment.map((value) => value / totalVolume) as [number, number, number])
      : undefined;
  return {
    meshes,
    bodyProperties,
    volume: totalVolume,
    area: totalArea,
    center,
  };
}

export function exportBodies(
  bodies: Body[],
  format: "step" | "stl" | "3mf",
): Blob {
  if (!bodies.length) throw new Error("Add a solid feature before exporting.");
  if (format === "3mf") return export3MF(bodies);
  if (format === "step")
    return exportSTEP(bodies, { modelUnit: "MM", unit: "MM" });
  return binarySTL(bodies.map(({ shape }) => printableMesh(shape)));
}
