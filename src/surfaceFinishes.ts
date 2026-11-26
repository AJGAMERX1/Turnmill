import {
  addHolesInFace,
  assembleWire,
  basicFaceExtrusion,
  isShape3D,
  makeBezierCurve,
  makeCompound,
  makeCylinder,
  makeFace,
  makeLine,
  makePolygon,
  measureVolume,
  Sketch,
  Vector,
  type Edge,
  type Shape3D,
} from "replicad";
import type { EvaluatedFinish } from "./finishingTypes";
import { getTurningStations } from "./secondaryStations";
import type { InkOutline } from "./markArtwork";
type Vec = [number, number, number];
type Knurl = Extract<EvaluatedFinish, { kind: "knurl" }>;
type Mark = Extract<EvaluatedFinish, { kind: "mark" }>;

function extent(shape: Shape3D) {
  const box = shape.boundingBox;
  try {
    return box.bounds;
  } finally {
    box.delete();
  }
}
export function grouped(shapes: Shape3D[]): Shape3D {
  const compound = makeCompound(shapes.splice(0));
  if (isShape3D(compound)) return compound;
  compound.delete();
  throw Error("The finishing tool contains an empty shape.");
}

export function radiusAt(shape: Shape3D, x: number, width: number, feature = "mark") {
  const candidates = getTurningStations(shape)
    .filter(
      (s) =>
        s.side === "external" &&
        s.xMin <= x + 1e-5 &&
        s.xMax >= x + width - 1e-5,
    )
    .map((s) => s.diameter / 2);
  if (!candidates.length)
    throw Error(
      `Move or shorten the ${feature} so its full width lies on a single cylindrical surface.`,
    );
  return Math.max(...candidates);
}

export function applyKnurl(
  shape: Shape3D,
  f: Knurl,
  kind: "revolve" | "extrude",
) {
  if (kind !== "revolve")
    throw Error(
      "Apply a knurl to a revolved feature with a cylindrical outside surface.",
    );
  const [lo, hi] = extent(shape),
    start = f.end === "start" ? lo[0] + f.offset : hi[0] - f.offset - f.length;
  const r = radiusAt(shape, start, f.length);
  if (Math.abs(f.diameter / 2 - r) > 0.001)
    throw Error(
      "This band has diameter " +
        (2 * r).toFixed(3) +
        " mm. Match that diameter or move the band to another cylinder.",
    );
  const halfTooth = (Math.PI * r) / f.count;
  if (f.depth >= Math.min(r, halfTooth * 0.8))
    throw Error(
      "Reduce the cut depth or groove count so adjacent grooves leave a crest.",
    );
  const extra = f.depth * 0.2,
    halfWidth = f.depth + extra;
  const face = makePolygon([
    [r - f.depth, 0, 0],
    [r + extra, -halfWidth, 0],
    [r + extra, halfWidth, 0],
  ]);
  let working = shape.clone();
  try {
    for (const direction of f.style === "diamond" ? [1, -1] : [0]) {
      const angle =
        (((direction * f.length * Math.tan((f.angle * Math.PI) / 180)) / r) *
          180) /
        Math.PI;
      const sketch = new Sketch(face.clone().outerWire(), {
        defaultOrigin: [0, 0, 0],
        defaultDirection: [0, 0, 1],
      });
      const master = sketch.extrude(f.length, {
        twistAngle: angle,
        origin: [0, 0, 0],
      });
      const cutters: Shape3D[] = [];
      try {
        for (let i = 0; i < f.count; i++) {
          cutters.push(
            master
              .clone()
              .rotate((i * 360) / f.count, [0, 0, 0], [0, 0, 1])
              .rotate(90, [0, 0, 0], [0, 1, 0])
              .translate([start, 0, 0]),
          );
        }
        const tools = grouped(cutters);
        try {
          const next = working.cut(tools);
          working.delete();
          working = next;
        } finally {
          tools.delete();
        }
      } finally {
        master.delete();
        cutters.forEach((c) => c.delete());
      }
    }
    if (measureVolume(shape) - measureVolume(working) < 1e-8)
      throw Error(
        "The grooves miss the body. Match the diameter and place the band over material.",
      );
    return working;
  } catch (error) {
    working.delete();
    throw error;
  } finally {
    face.delete();
  }
}

function markWire(outline: InkOutline, origin: Vec, scale: number) {
  const edges: Edge[] = [];
  try {
    for (const segment of outline) {
      const points: Vec[] = segment.map(([x, y]) => [
        origin[0] + x * scale,
        origin[1] + y * scale,
        origin[2],
      ]);
      edges.push(
        points.length === 2
          ? makeLine(points[0], points[1])
          : makeBezierCurve(points),
      );
    }
    return assembleWire(edges);
  } finally {
    edges.forEach((e) => e.delete());
  }
}

export function applyMark(
  shape: Shape3D,
  f: Mark,
  kind: "revolve" | "extrude",
) {
  const [lo, hi] = extent(shape),
    w = f.artwork.width * f.height;
  const x = f.end === "start" ? lo[0] + f.offset : hi[0] - f.offset - w;
  if (kind === "revolve" && (x < lo[0] - 1e-5 || x + w > hi[0] + 1e-5))
    throw Error(
      "Reduce artwork height or move its start so its width fits on the body.",
    );
  const wrapped = kind === "revolve",
    emboss = f.method === "emboss";
  const r = wrapped ? radiusAt(shape, x, w) : 0;
  if (wrapped && (f.depth >= r || f.height >= 2 * (r - f.depth)))
    throw Error(
      "Reduce the mark height or depth to fit the visible side of the cylinder.",
    );
  const baseY = wrapped ? 0 : (lo[1] + hi[1]) / 2;
  const z = wrapped ? 0 : emboss ? hi[2] - 0.002 : hi[2] - f.depth;
  const height = wrapped ? r + f.depth + 0.02 : f.depth + 0.002;
  const vector = new Vector([0, 0, height]);
  const tools: Shape3D[] = [];
  let tool: Shape3D | undefined;
  try {
    for (const outline of f.artwork.outlines) {
      const wire = markWire(outline.outer, [x, baseY, z], f.height);
      let face = makeFace(wire);
      wire.delete();
      const holes = outline.holes.map((h) =>
        markWire(h, [x, baseY, z], f.height),
      );
      try {
        if (holes.length) {
          const cut = addHolesInFace(face, holes);
          face.delete();
          face = cut;
        }
        tools.push(basicFaceExtrusion(face, vector));
      } finally {
        face.delete();
        holes.forEach((h) => h.delete());
      }
    }
    tool = grouped(tools);
    if (wrapped) {
      const pad = 0.001;
      const outer = makeCylinder(
        emboss ? r + f.depth : r + pad,
        w + 0.02,
        [x - 0.01, 0, 0],
        [1, 0, 0],
      );
      const inner = makeCylinder(
        emboss ? r - pad : r - f.depth,
        w + 0.02,
        [x - 0.01, 0, 0],
        [1, 0, 0],
      );
      const band = outer.cut(inner);
      outer.delete();
      inner.delete();
      try {
        const clipped = tool.intersect(band);
        tool.delete();
        tool = clipped;
      } finally {
        band.delete();
      }
      if (f.rotation) tool = tool.rotate(f.rotation, [0, 0, 0], [1, 0, 0]);
    } else {
      if (f.rotation)
        tool = tool.rotate(f.rotation, [x + w / 2, baseY, hi[2]], [0, 0, 1]);
      // Intersect the actual rotated outline with a thin layer of surface material.
      // Its holes remain holes, including on a face already containing pockets.
      const layer = Math.min(0.01, height / 2, (hi[2] - lo[2]) / 2);
      const probe = tool.clone().translate([0, 0, hi[2] - layer - z]);
      try {
        const support = shape.intersect(probe);
        try {
          const expected = (measureVolume(tool) * layer) / height;
          if (measureVolume(support) < expected * (1 - 0.001) - 1e-10)
            throw Error(
              "The artwork extends outside the flat face. Reduce its height, change its rotation, or move it onto the stock.",
            );
        } finally {
          support.delete();
        }
      } finally {
        probe.delete();
      }
    }
    const result = emboss ? shape.fuse(tool) : shape.cut(tool);
    if (Math.abs(measureVolume(result) - measureVolume(shape)) < 1e-8) {
      result.delete();
      throw Error(
        "The artwork misses the selected surface. Move the mark over material.",
      );
    }
    return result;
  } finally {
    vector.delete();
    tool?.delete();
    tools.forEach((t) => t.delete());
  }
}
