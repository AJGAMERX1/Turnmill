import {
  BoundingBox,
  getOC,
  makePolygon,
  measureVolume,
  revolution,
  type Shape3D,
} from "replicad";
import type { EvaluatedFinish } from "./finishingTypes";

type Point = [number, number, number];
type Hole = Extract<EvaluatedFinish, { kind: "hole" }>;
const modelTolerance = 1e-6;

function holeFrame(stock: Shape3D, turned: boolean, hole: Hole) {
  const box = new BoundingBox();
  try {
    getOC().BRepBndLib.AddOptimal(stock.wrapped, box.wrapped, false, false);
    const [lo, hi] = box.bounds;
    const axis = turned ? 0 : 2;
    const u = turned ? 1 : 0,
      v = turned ? 2 : 1;
    const origin: Point = [0, 0, 0];
    origin[axis] = hole.end === "start" ? lo[axis] : hi[axis];
    origin[u] = (turned ? 0 : (lo[u] + hi[u]) / 2) + (hole.offsetU ?? 0);
    origin[v] = (turned ? 0 : (lo[v] + hi[v]) / 2) + (hole.offsetV ?? 0);
    const direction: Point = [0, 0, 0];
    direction[axis] = hole.end === "start" ? 1 : -1;
    return { origin, axis, u, direction, span: hi[axis] - lo[axis] };
  } finally {
    box.delete();
  }
}

type Rim = { depth: number; radius: number; length: number; message: string };

// Match both full circles and circles split across several topological edges.
function verifyRims(
  stock: Shape3D,
  frame: ReturnType<typeof holeFrame>,
  rims: Rim[],
) {
  const edges = stock.edges;
  try {
    for (const edge of edges) {
      if (edge.geomType !== "CIRCLE") continue;
      const curve = new (getOC().BRepAdaptor_Curve)(edge.wrapped);
      const circle = curve.Circle(),
        center = circle.Location(),
        axis = circle.Axis(),
        normal = axis.Direction();
      try {
        const xyz = [center.X(), center.Y(), center.Z()];
        const parallel = Math.abs(
          [normal.X(), normal.Y(), normal.Z()][frame.axis],
        );
        if (parallel < 1 - 1e-10) continue;
        const radius = circle.Radius();
        for (const rim of rims) {
          if (Math.abs(radius - rim.radius) > modelTolerance) continue;
          if (
            xyz.every(
              (val, i) =>
                Math.abs(
                  val - (frame.origin[i] + frame.direction[i] * rim.depth),
                ) <= modelTolerance,
            )
          )
            rim.length += edge.length;
        }
      } finally {
        normal.delete();
        axis.delete();
        center.delete();
        circle.delete();
        curve.delete();
      }
    }
    for (const rim of rims) {
      if (
        Math.abs(rim.length - 2 * Math.PI * rim.radius) >
        Math.max(1e-5, rim.radius * 1e-7)
      )
        throw Error(rim.message);
    }
  } finally {
    edges.forEach((edge) => edge.delete());
  }
}

export function cutHole(stock: Shape3D, turned: boolean, hole: Hole): Shape3D {
  const frame = holeFrame(stock, turned, hole);
  const through = hole.termination === "through";
  const modern = hole.termination !== undefined;
  const overrun = 0.001;
  const drillDepth = through ? frame.span + overrun : hole.length;
  const r = hole.diameter / 2;
  const profile = hole.profile ?? "straight";
  const outer = profile === "straight" ? r : hole.seatDiameter! / 2;
  const seat =
    profile === "counterbore"
      ? hole.seatDepth!
      : profile === "countersink"
        ? (outer - r) / Math.tan((hole.seatAngle! * Math.PI) / 360)
        : 0;
  if (modern && !through && drillDepth >= frame.span - modelTolerance)
    throw Error(
      "The blind depth reaches the opposite end. Use Through all or shorten the hole.",
    );
  if (seat && seat >= Math.min(frame.span, drillDepth) - modelTolerance)
    throw Error(
      "The recess reaches past the available drill depth. Reduce its depth or opening diameter.",
    );

  // One revolved meridian creates a continuous cutter with an analytic cone or shoulder.
  const meridian: [number, number][] = [
    [-overrun, 0],
    [-overrun, outer],
  ];
  if (profile === "counterbore") meridian.push([seat, outer], [seat, r]);
  else if (profile === "countersink") meridian.push([0, outer], [seat, r]);
  meridian.push([drillDepth, r], [drillDepth, 0]);
  const vertices = meridian.map(([depth, radius]) => {
    const p: Point = [...frame.origin];
    p[frame.axis] += depth * frame.direction[frame.axis];
    p[frame.u] += radius;
    return p;
  });
  const face = makePolygon(vertices);
  let cutter: Shape3D | undefined, result: Shape3D | undefined;
  try {
    cutter = revolution(face, frame.origin, frame.direction, 360);
    result = stock.cut(cutter);
    const removed = measureVolume(stock) - measureVolume(result);
    if (!(removed > 1e-10))
      throw Error(
        "The hole misses the material or is already cut. Check the location, diameter, and entry end.",
      );
    if (modern) {
      const rims: Rim[] = [
        {
          depth: 0,
          radius: outer,
          length: 0,
          message:
            "The opening breaks out of the selected end face. Move the hole onto the face or reduce its opening diameter.",
        },
      ];
      if (seat)
        rims.push({
          depth: seat,
          radius: r,
          length: 0,
          message:
            "The recess runs into a void or an edge. Reduce the recess or move the hole to thicker stock.",
        });
      if (!through)
        rims.push({
          depth: drillDepth,
          radius: r,
          length: 0,
          message:
            "The blind hole breaks through the stock or an existing void. Shorten the blind depth or choose Through all.",
        });
      verifyRims(result, frame, rims);
    }
    const completed = result;
    result = undefined;
    return completed;
  } finally {
    result?.delete();
    cutter?.delete();
    face.delete();
  }
}
