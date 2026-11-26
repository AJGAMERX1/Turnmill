import {
  assembleWire, basicFaceExtrusion, makeFace, makeLine,
  makePolygon, makeThreePointArc, measureVolume, revolution, Vector,
  type Edge, type Shape3D,
} from "replicad";
import type { EvaluatedFinish } from "./finishingTypes";
import { grouped, radiusAt } from "./surfaceFinishes";

type Grip = Extract<EvaluatedFinish, { kind: "grip" }>;
type XYZ = [number, number, number];
const axis: XYZ = [1, 0, 0];
const origin: XYZ = [0, 0, 0];

function annulus(x: number, span: number, inner: number, outer: number) {
  const face = makePolygon([
    [x, inner, 0], [x + span, inner, 0],
    [x + span, outer, 0], [x, outer, 0],
  ]);
  try { return revolution(face, origin, axis, 360); }
  finally { face.delete(); }
}

// Swept footprint of a radial flat end mill traversing the band along X.
function flute(x: number, f: Grip, floor: number, height: number): Shape3D {
  const half = f.width / 2, a = x + half, b = x + f.length - half;
  const point = (axial: number, tangent: number): XYZ => [axial, tangent, floor];
  const edges: Edge[] = [];
  try {
    edges.push(makeLine(point(a, -half), point(b, -half)));
    edges.push(makeThreePointArc(point(b, -half), point(b + half, 0), point(b, half)));
    edges.push(makeLine(point(b, half), point(a, half)));
    edges.push(makeThreePointArc(point(a, half), point(a - half, 0), point(a, -half)));
    const wire = assembleWire(edges);
    try {
      const face = makeFace(wire);
      const up = new Vector([0, 0, height]);
      try { return basicFaceExtrusion(face, up); }
      finally { up.delete(); face.delete(); }
    } finally { wire.delete(); }
  } finally { edges.forEach(e => e.delete()); }
}

function cutPattern(shape: Shape3D, count: number, cutter: (index: number) => Shape3D): Shape3D {
  const cutters: Shape3D[] = [];
  try {
    for (let i = 0; i < count; i++) cutters.push(cutter(i));
    const tool = grouped(cutters);
    try { return shape.cut(tool); }
    finally { tool.delete(); }
  } finally { cutters.forEach(c => c.delete()); }
}

export function applyGripMilling(shape: Shape3D, f: Grip): Shape3D {
  const bounds = shape.boundingBox;
  const [[lo], [hi]] = bounds.bounds;
  bounds.delete();
  const x = f.end === "start" ? lo + f.offset : hi - f.offset - f.length;
  if (x < lo - 1e-5 || x + f.length > hi + 1e-5)
    throw Error("The grip band extends past the part. Reduce its offset or length.");
  const r = radiusAt(shape, x, f.length, "grip band");
  const floor = r - f.depth;
  if (floor <= 1e-5) throw Error("Reduce the groove depth to leave material under the grip.");
  if (f.style !== "rings") {
    if (Math.hypot(floor, f.width / 2) >= r - 1e-7)
      throw Error("This flute is too wide for its cut depth on the curved surface. Reduce its width or increase depth.");
    if (f.count > 1 && Math.atan2(f.width / 2, floor) >= Math.PI / f.count)
      throw Error("Adjacent flutes touch. Reduce their width or count.");
  }

  // Bound the entire band, including steps or tapered bores, before cutting.
  const support = annulus(x, f.length, Math.max(0, floor - 0.001), r);
  try {
    const stock = shape.intersect(support);
    try {
      const required = measureVolume(support);
      if (required - measureVolume(stock) > Math.max(1e-8, required * 1e-6))
        throw Error("The grooves reach a bore or an interrupted surface. Reduce their depth or move the band onto uninterrupted stock.");
    } finally { stock.delete(); }
  } finally { support.delete(); }

  const overrun = Math.max(0.01, f.depth / 10);
  let work = shape.clone();
  try {
    if (f.style !== "flutes") {
      const step = f.count > 1 ? (f.length - f.width) / (f.count - 1) : 0;
      const first = f.count === 1 ? x + (f.length - f.width) / 2 : x;
      const next = cutPattern(work, f.count, i => annulus(first + i * step, f.width, floor, r + overrun));
      work.delete(); work = next;
    }
    if (f.style !== "rings") {
      const master = flute(x, f, floor, f.depth + overrun);
      try {
        const next = cutPattern(work, f.count, i => master.clone().rotate(360 * i / f.count, origin, axis));
        work.delete(); work = next;
      } finally { master.delete(); }
    }
    if (measureVolume(shape) - measureVolume(work) <= 1e-8)
      throw Error("The grip cutters removed no material. Increase the groove width or depth.");
    return work;
  } catch (error) { work.delete(); throw error; }
}
