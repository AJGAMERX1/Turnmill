import { evaluate, isExpression } from "./expressions";
import type { Sketch } from "./types";

type Values = Record<string, number>;
type Vertex = { x: number; r: number; xSource: string; ySource: string };
type End = "start" | "end";
export type ConeSegment = {
  edge: number;
  tipEnd: End;
  startX: number;
  endX: number;
  startDiameter: string;
  endDiameter: string;
  startDiameterMm: number;
  endDiameterMm: number;
};

const tolerance = 1e-7;
const equal = (a: number, b: number) => Math.abs(a - b) <= tolerance;
const mm = (n: number) => Number(n.toPrecision(15)) + " mm";

function profile(sketch: Sketch, values: Values) {
  const n = sketch.points.length;
  if (n < 3) return;
  const sources = sketch.points.map(p => ({ ...p }));
  for (const c of sketch.constraints) {
    // More general constraints can move the endpoints away from their seeds.
    if (!["horizontal", "vertical", "x", "y"].includes(c.type)) return;
    if (c.indices.length !== 1 || !sources[c.indices[0]]) return;
    if ((c.type === "x" || c.type === "y") && c.value) sources[c.indices[0]][c.type] = c.value;
  }
  const ys = sources.map(p => evaluate(p.y, values));
  if (Math.min(...ys) < -tolerance && Math.max(...ys) > tolerance) return;
  const sign = ys.some(y => y > tolerance) ? 1 : -1;
  const vertices: Vertex[] = sources.map((p, i) => ({
    x: evaluate(p.x, values), r: sign * ys[i], xSource: p.x, ySource: p.y,
  }));
  for (const c of sketch.constraints) {
    const a = vertices[c.indices[0]], b = vertices[(c.indices[0] + 1) % n];
    if (c.type === "vertical" && !equal(a.x, b.x) || c.type === "horizontal" && !equal(a.r, b.r)) return;
  }
  return { vertices, sign };
}

function radiusAt(a: Vertex, b: Vertex, x: number) {
  return a.r + (b.r - a.r) * ((x - a.x) / (b.x - a.x));
}

// On every overlapping axial interval, two straight radii differ linearly.
// Comparing both ends finds hidden bores and crossings, including stepped profiles.
function isOutside(vertices: Vertex[], edge: number) {
  const a = vertices[edge], b = vertices[(edge + 1) % vertices.length];
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
  if (equal(left, right)) return false;
  return vertices.every((c, i) => {
    if (edge === i) return true;
    const d = vertices[(i + 1) % vertices.length];
    if (equal(c.x, d.x)) return c.x <= left + tolerance || c.x >= right - tolerance
      || Math.max(c.r, d.r) <= radiusAt(a, b, c.x) + tolerance;
    const lo = Math.max(left, Math.min(c.x, d.x)), hi = Math.min(right, Math.max(c.x, d.x));
    if (hi - lo <= tolerance) return true;
    return [lo, hi].every(x => radiusAt(c, d, x) <= radiusAt(a, b, x) + tolerance);
  });
}

function touchesOtherEdge(vertices: Vertex[], edge: number) {
  const n = vertices.length, a = vertices[edge], b = vertices[(edge + 1) % n];
  // Test the moved outline against non-neighboring edges, including contact
  // at a step corner. A tangency here would create a zero-thickness wall.
  const side = (p: Vertex, q: Vertex, v: Vertex) => {
    const dx = q.x - p.x, dr = q.r - p.r;
    const d = dx * (v.r - p.r) - dr * (v.x - p.x);
    return Math.abs(d) <= tolerance * Math.hypot(dx, dr) ? 0 : Math.sign(d);
  };
  return vertices.some((c, i) => {
    if (i === edge || (i + 1) % n === edge || (edge + 1) % n === i) return false;
    const d = vertices[(i + 1) % n];
    if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - tolerance || Math.max(c.x, d.x) < Math.min(a.x, b.x) - tolerance
      || Math.max(a.r, b.r) < Math.min(c.r, d.r) - tolerance || Math.max(c.r, d.r) < Math.min(a.r, b.r) - tolerance) return false;
    return side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0;
  });
}

function diameter(v: Vertex, sign: number) {
  // Preserve the text of a diameter entered from the Inspector.
  const wrapped = v.ySource.match(/^\((.+)\) \* (-?0\.5)$/);
  if (wrapped && Number(wrapped[2]) === sign / 2) return wrapped[1];
  try { return mm(sign * 2 * evaluate(v.ySource, {})); }
  catch { return `(${v.ySource}) * ${2 * sign}`; }
}

function segments(sketch: Sketch, vertices: Vertex[], sign: number): ConeSegment[] {
  const items: ConeSegment[] = [];
  vertices.forEach((a, edge) => {
    const b = vertices[(edge + 1) % vertices.length];
    const saved = sketch.coneEdge;
    const lastEdited = saved?.edge === edge && saved.pointCount === vertices.length
      && saved.stations?.[0] === a.xSource && saved.stations?.[1] === b.xSource;
    if (equal(a.r, b.r) && !lastEdited || !isOutside(vertices, edge)) return;
    const [start, end] = a.x < b.x ? [a, b] : [b, a];
    items.push({ edge, tipEnd: lastEdited ? saved.tipEnd : start.r < end.r ? "start" : "end",
      startX: start.x, endX: end.x,
      startDiameter: diameter(start, sign), endDiameter: diameter(end, sign),
      startDiameterMm: 2 * start.r, endDiameterMm: 2 * end.r });
  });
  return items.sort((a, b) => a.startX - b.startX);
}

export function coneSegments(sketch: Sketch, values: Values): ConeSegment[] {
  const p = profile(sketch, values);
  return p ? segments(sketch, p.vertices, p.sign) : [];
}

export function setConeDiameter(sketch: Sketch, segment: ConeSegment, end: End, expression: string, values: Values): Sketch {
  const p = profile(sketch, values);
  const edge = segment.edge;
  if (!p || !segments(sketch, p.vertices, p.sign).some(s => s.edge === edge))
    throw Error("Select the taper again before changing its diameter.");
  const { vertices, sign } = p;
  const n = vertices.length, next = (i: number, step = 1) => (i + step + n) % n;
  const diameterMm = evaluate(expression, values);
  if (diameterMm < 0) throw Error("Enter an outside diameter of zero or more.");
  const r = diameterMm / 2, ySource = `(${expression}) * ${sign / 2}`;
  const a = vertices[edge], b = vertices[next(edge)];
  const endpoint = (a.x < b.x) === (end === "start") ? edge : next(edge);
  const direction = endpoint === edge ? -1 : 1;
  const group = new Set([endpoint]);
  let last = endpoint;
  // A straight cylindrical land at this end carries the same outside diameter.
  let adjacent = next(last, direction);
  while (!group.has(adjacent) && equal(vertices[adjacent].r, vertices[last].r)
    && isOutside(vertices, direction === 1 ? last : adjacent)) {
    group.add(adjacent);
    last = adjacent;
    adjacent = next(last, direction);
  }
  const corner = vertices[last], neighbor = vertices[adjacent];
  const opposite = endpoint === edge ? b : a;
  const split = !equal(corner.x, neighbor.x)
    && (neighbor.x - corner.x) * (opposite.x - corner.x) > 0;
  const rawY = String(sign * r);
  const sizing = { ...sketch.sizing };
  delete sizing.y;
  let points = sketch.points.slice(), constraints = sketch.constraints.slice(), editedEdge = edge;
  let changedEdges: number[];

  if (split) {
    // A knife edge is a single vertex shared by the taper and the bore (or axis).
    // Keep its original drivers on the bore and insert a separate outside vertex.
    if (group.size !== 1) throw Error("Use Edit sketch to change this returning profile.");
    if (equal(r, corner.r)) {
      if (expression === diameter(corner, sign)) return sketch;
      throw Error("Increase the outside diameter to open a rim at this shared tip.");
    }
    if (r < corner.r) throw Error(`Keep the outside diameter above the bore at this end (${mm(2 * corner.r)}).`);
    const slot = direction === -1 ? endpoint + 1 : endpoint;
    const idx = (i: number) => i >= slot ? i + 1 : i;
    points.splice(slot, 0, { x: corner.xSource, y: ySource });
    editedEdge = endpoint === edge ? slot : idx(edge);
    constraints = constraints.map(c => ({ ...c, indices: c.indices.map(idx) }));
    const rimEdge = direction === -1 ? idx(endpoint) : slot;
    changedEdges = [editedEdge, rimEdge];
    if (!isExpression(corner.xSource)) {
      constraints.push({ id: crypto.randomUUID(), type: "vertical", indices: [rimEdge] });
    }
    const cached = sizing.x;
    if (cached?.coordinates.length === n && vertices.every((v, i) => v.xSource === cached.coordinates[i])) {
      const coordinates = cached.coordinates.slice();
      coordinates.splice(slot, 0, corner.xSource);
      sizing.x = { ...cached, coordinates };
    }
  } else {
    // A radial step must keep its original ordering. Collapsing it would leave
    // a zero-length edge in the B-rep or turn a section of the bore inside out.
    if (equal(corner.x, neighbor.x) && (equal(r, neighbor.r) || (corner.r - neighbor.r) * (r - neighbor.r) < 0))
      throw Error(`Keep this outside diameter ${corner.r > neighbor.r ? "above" : "below"} the adjoining diameter (${mm(2 * neighbor.r)}).`);
    changedEdges = [...group].flatMap(i => [i, next(i, -1)]);
    const fixedY = new Set(constraints.filter(c => c.type === "y").map(c => c.indices[0]));
    points = points.map((point, i) => group.has(i) ? { ...point, y: fixedY.has(i) ? rawY : ySource } : point);
    constraints = constraints.map(c => c.type === "y" && group.has(c.indices[0]) ? { ...c, value: ySource } : c);
  }

  const changed = { ...sketch, points, constraints, sizing };
  const updated = profile(changed, values);
  if (!updated || !isOutside(updated.vertices, editedEdge) || changedEdges.some(i => touchesOtherEdge(updated.vertices, i)))
    throw Error("That diameter cuts into another part of the profile. Increase the wall thickness or edit the sketch.");
  const v = updated.vertices;
  return { ...changed, coneEdge: { edge: editedEdge, pointCount: v.length, tipEnd: segment.tipEnd,
    stations: [v[editedEdge].xSource, v[(editedEdge + 1) % v.length].xSource] } };
}
