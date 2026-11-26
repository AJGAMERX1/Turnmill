import {
  assembleWire, basicFaceExtrusion, loft, makeCircle, makeFace, makeLine,
  makePolygon, makeThreePointArc, measureVolume, revolution, Vector,
  type Edge, type Shape3D, type Wire,
} from "replicad";
import type { EvaluatedFinish } from "./finishingTypes";
import { grouped } from "./surfaceFinishes";
import { gripRadiusAt, measureGripStock, type GripBand } from "./gripBands";

type Grip = Extract<EvaluatedFinish, { kind: "grip" }>;
type XYZ = [number, number, number];
const axis: XYZ = [1, 0, 0];
const origin: XYZ = [0, 0, 0];

// Loft exact end circles. Revolving a short, nearly horizontal line can make
// OpenCascade classify the resulting cutter as a cylinder and lose its slope.
function frustum(x: number, span: number, startRadius: number, endRadius: number) {
  const wires: Wire[] = [];
  try {
    const circle = (at: number, radius: number) => {
      const edge = makeCircle(radius, [at, 0, 0], axis);
      try { wires.push(assembleWire([edge])); }
      finally { edge.delete(); }
    };
    if (startRadius > 0) circle(x, startRadius);
    if (endRadius > 0) circle(x + span, endRadius);
    return loft(wires, { ruled: true,
      startPoint: startRadius === 0 ? [x, 0, 0] : undefined,
      endPoint: endRadius === 0 ? [x + span, 0, 0] : undefined,
    });
  } finally { wires.forEach(wire => wire.delete()); }
}

// The radial offsets stay constant along the band.
function annulus(band: GripBand, x: number, span: number, innerOffset: number, outerOffset: number) {
  const startRadius = gripRadiusAt(band, x);
  const endRadius = gripRadiusAt(band, x + span);
  if (Math.abs(startRadius - endRadius) > 1e-9) {
    const outer = frustum(x, span, startRadius + outerOffset, endRadius + outerOffset);
    const a = Math.max(0, startRadius + innerOffset), b = Math.max(0, endRadius + innerOffset);
    if (!a && !b) return outer;
    try {
      const inner = frustum(x, span, a, b);
      try { return outer.cut(inner); }
      finally { inner.delete(); }
    } finally { outer.delete(); }
  }
  const face = makePolygon([
    [x, Math.max(0, startRadius + innerOffset), 0],
    [x + span, Math.max(0, endRadius + innerOffset), 0],
    [x + span, endRadius + outerOffset, 0], [x, startRadius + outerOffset, 0],
  ]);
  try { return revolution(face, origin, axis, 360); }
  finally { face.delete(); }
}

// Swept footprint of a radial flat end mill traversing the band along X.
function capsule(x: number, f: Grip, floor: number, height: number): Shape3D {
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

function flute(x: number, f: Grip, startRadius: number, endRadius: number, overrun: number): Shape3D {
  const floor = Math.min(startRadius, endRadius) - f.depth;
  const top = Math.max(startRadius, endRadius) + overrun;
  if (Math.abs(endRadius - startRadius) < 1e-9)
    return capsule(x, f, floor, top - floor);

  // Clip the vertical capsule with an inclined floor. Its projected width and
  // round ends stay true even as the depth follows the cone along X.
  const slope = (endRadius - startRadius) / f.length;
  const margin = Math.max(overrun, 0.01);
  const left = x - margin, right = x + f.length + margin;
  const side = f.width / 2 + margin;
  const wedgeTop = top + margin * (1 + Math.abs(slope));
  const face = makePolygon([
    [left, -side, startRadius - f.depth - slope * margin],
    [right, -side, endRadius - f.depth + slope * margin],
    [right, -side, wedgeTop], [left, -side, wedgeTop],
  ]);
  const across = new Vector([0, 2 * side, 0]);
  try {
    const wedge = basicFaceExtrusion(face, across);
    try {
      const blank = capsule(x, f, floor - margin, top - floor + margin);
      try { return blank.intersect(wedge); }
      finally { blank.delete(); }
    } finally { wedge.delete(); }
  } finally { across.delete(); face.delete(); }
}

function selectBand(bands: GripBand[], x: number, length: number): GripBand {
  const candidates = bands.filter(band => band.start <= x + 1e-6 && band.end >= x + length - 1e-6);
  if (!candidates.length)
    throw Error("The grip crosses a shoulder, curve, or gap. Place it on a straight barrel section or a straight-sided taper.");
  return candidates.reduce((outer, next) =>
    gripRadiusAt(next, x + length / 2) > gripRadiusAt(outer, x + length / 2) ? next : outer);
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
  const { minX: lo, maxX: hi, bands } = measureGripStock(shape);
  const x = f.end === "start" ? lo + f.offset : hi - f.offset - f.length;
  if (x < lo - 1e-5 || x + f.length > hi + 1e-5)
    throw Error("The grip band extends past the part. Reduce its offset or length.");
  const band = selectBand(bands, x, f.length);
  const startRadius = gripRadiusAt(band, x), endRadius = gripRadiusAt(band, x + f.length);
  const minRadius = Math.min(startRadius, endRadius);
  const floor = minRadius - f.depth;
  if (floor <= 1e-5) throw Error("Reduce the groove depth to leave material under the grip.");
  if (f.style !== "rings") {
    if (Math.hypot(floor, f.width / 2) >= minRadius - 1e-7)
      throw Error("This flute is too wide for its cut depth on the curved surface. Reduce its width or increase depth.");
    if (f.count > 1 && Math.atan2(f.width / 2, floor) >= Math.PI / f.count)
      throw Error("Adjacent flutes touch. Reduce their width or count.");
  }

  // Bound the entire band, including steps or tapered bores, before cutting.
  const support = annulus(band, x, f.length, -f.depth - 0.001, 0);
  try {
    const stock = shape.intersect(support);
    try {
      const required = measureVolume(support);
      if (required - measureVolume(stock) > Math.max(1e-8, required * 1e-6))
        throw Error("The grooves reach a bore or an interrupted surface. Reduce their depth or move the band onto uninterrupted stock.");
    } finally { stock.delete(); }
  } finally { support.delete(); }

  const overrun = Math.max(0.01, f.depth / 10);
  // A trimmed cylindrical face can extend past a boss. Although the annulus
  // beneath it is solid, cutting there would bury part of the pattern inside the boss.
  const outside = annulus(band, x, f.length, 0, overrun);
  try {
    const obstruction = shape.intersect(outside);
    try {
      if (measureVolume(obstruction) > Math.max(1e-8, measureVolume(outside) * 1e-6))
        throw Error("Part of this grip lies beneath a raised feature. Move it onto exposed barrel stock.");
    } finally { obstruction.delete(); }
  } finally { outside.delete(); }

  let work = shape.clone();
  try {
    if (f.style !== "flutes") {
      const step = f.count > 1 ? (f.length - f.width) / (f.count - 1) : 0;
      const first = f.count === 1 ? x + (f.length - f.width) / 2 : x;
      const next = cutPattern(work, f.count, i => annulus(band, first + i * step, f.width, -f.depth, overrun));
      work.delete(); work = next;
    }
    if (f.style !== "rings") {
      const master = flute(x, f, startRadius, endRadius, overrun);
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
