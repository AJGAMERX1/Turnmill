import {
  basicFaceExtrusion,
  BoundingBox,
  getOC,
  isShape3D,
  makeCompound,
  makePolygon,
  measureVolume,
  Vector,
  type Shape3D,
} from "replicad";
import { positioned } from "./motionGeometry";
import { buildScaleLabelCutters } from "./secondaryLabelCuts";
import type { ScaleFace, ScalePlacement } from "./secondaryEngraving";
import type { EvaluatedFeature } from "./types";

type Ruler = NonNullable<EvaluatedFeature["ruler"]>;
type Axis = [number, number, number];
const axes: Record<ScaleFace, [Axis, Axis, Axis]> = {
  top: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  bottom: [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ],
  front: [
    [1, 0, 0],
    [0, 0, 1],
    [0, -1, 0],
  ],
  back: [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  right: [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ],
  left: [
    [0, -1, 0],
    [0, 0, 1],
    [-1, 0, 0],
  ],
};
const dot = (a: Axis, b: Axis) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function placementMatrix(stock: Shape3D, place: ScalePlacement) {
  const box = new BoundingBox();
  const [u, v, n] = axes[place.face];
  let bounds: [Axis, Axis];
  try {
    getOC().BRepBndLib.AddOptimal(stock.wrapped, box.wrapped, false, false);
    bounds = box.bounds;
  } finally {
    box.delete();
  }
  const u0 = Math.min(...bounds.map((p) => dot(u, p))) + place.u;
  const v0 = Math.min(...bounds.map((p) => dot(v, p))) + place.v;
  const normalBounds = bounds.map((p) => dot(n, p));
  const surface = Math.max(...normalBounds);
  const faces = stock.faces;
  try {
    const onPlane = faces.some((face) => {
      if (face.geomType !== "PLANE") return false;
      const direction = face.normalAt(),
        center = face.center;
      try {
        return (
          Math.abs(dot(direction.toTuple(), n)) > 1 - 1e-10 &&
          Math.abs(dot(center.toTuple(), n) - surface) < 1e-6
        );
      } finally {
        direction.delete();
        center.delete();
      }
    });
    if (!onPlane)
      throw Error(
        "This side has no outer flat face. Choose another side or machine a flat surface first.",
      );
  } finally {
    faces.forEach((f) => f.delete());
  }
  const c = Math.cos((place.angle * Math.PI) / 180),
    s = Math.sin((place.angle * Math.PI) / 180);
  const origin = u.map((_, i) => u[i] * u0 + v[i] * v0 + n[i] * surface);
  return {
    matrix: [
      ...u.map((_, i) => c * u[i] + s * v[i]),
      0,
      ...v.map((_, i) => -s * u[i] + c * v[i]),
      0,
      ...n,
      0,
      ...origin,
      1,
    ],
    span: surface - Math.min(...normalBounds),
  };
}

function makeTools(ruler: Ruler, base: number, height: number) {
  const parts: Shape3D[] = [];
  const direction = new Vector([0, 0, height]);
  try {
    for (const polygon of ruler.ticks) {
      const face = makePolygon(polygon.map(([x, y]) => [x, y, base]));
      try {
        parts.push(basicFaceExtrusion(face, direction));
      } finally {
        face.delete();
      }
    }
    parts.push(...buildScaleLabelCutters(ruler.labels ?? [], base, height));
    if (!parts.length) throw Error("Add at least one graduation to engrave.");
    const group = makeCompound(parts);
    parts.length = 0;
    if (!isShape3D(group)) {
      group.delete();
      throw Error("A graduation outline is invalid. Check its width.");
    }
    return group;
  } finally {
    direction.delete();
    parts.forEach((p) => p.delete());
  }
}

/** Probe the complete ink footprint, including a thin floor beneath the requested cut.
 * A simple bounding box cannot detect missing stock at a hole, chamfer or shoulder. */
export function cutScale(
  stock: Shape3D,
  ruler: Ruler,
  thickness: number,
): Shape3D {
  const over = 0.01,
    depth = ruler.depth;
  if (!ruler.placement) {
    const tools = makeTools(ruler, thickness - depth, depth + over);
    try {
      return stock.cut(tools);
    } finally {
      tools.delete();
    }
  }
  const { matrix, span } = placementMatrix(stock, ruler.placement);
  if (!(depth > 0 && depth < span - 1e-7))
    throw Error(
      "Set the engraving depth below the part thickness on the selected face.",
    );
  const floorAllowance = Math.min(0.0001, (span - depth) / 2),
    height = depth + floorAllowance + over;
  const local = makeTools(ruler, -depth - floorAllowance, height);
  // Existing stock may extend beyond the layout, so the final cut always
  // uses full-width tools. Only the in-layout footprint needs a depth floor.
  let probeTools = local;
  try {
    if (ruler.support) {
      const ticks = ruler.ticks.map((p, i) => ruler.support?.[i] ?? p);
      probeTools = makeTools(
        { ...ruler, ticks },
        -depth - floorAllowance,
        height,
      );
    }
    const probe = positioned(probeTools, matrix);
    try {
      const expected =
        (measureVolume(probeTools) * (depth + floorAllowance)) / height;
      const support = stock.intersect(probe);
      try {
        if (
          Math.abs(measureVolume(support) - expected) >
          Math.max(1e-9, expected * 1e-7)
        )
          throw Error(
            "Some graduations run off the face, cross a hole or break through the part. Move the layout or reduce the cut depth.",
          );
      } finally {
        support.delete();
      }
    } finally {
      probe.delete();
    }
    for (let i = 0; i < 3; i++)
      matrix[12 + i] += matrix[8 + i] * floorAllowance;
    const tool = positioned(local, matrix);
    try {
      return stock.cut(tool);
    } finally {
      tool.delete();
    }
  } finally {
    if (probeTools !== local) probeTools.delete();
    local.delete();
  }
}
