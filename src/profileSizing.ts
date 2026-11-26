import { evaluate, isExpression } from "./expressions";
import type { Sketch } from "./types";

type Axis = "x" | "y";
type SavedRange = NonNullable<NonNullable<Sketch["sizing"]>[Axis]>;
export type ProfileRange = {
  axis: Axis;
  radial: boolean;
  sign: number;
  lower: string;
  size: string;
  fractions: number[];
  hasBore: boolean;
};

const mm = (v: number) => Number(v.toPrecision(15)) + " mm";
function constant(expression: string) {
  try { return evaluate(expression, {}); } catch { return undefined; }
}

export function axisSources(sketch: Sketch, axis: Axis) {
  const sources = sketch.points.map((p) => p[axis]);
  for (const rule of sketch.constraints) {
    if (rule.type === axis && rule.value) sources[rule.indices[0]] = rule.value;
  }
  return sources;
}
function matchingRange(sketch: Sketch, axis: Axis) {
  const cached = sketch.sizing?.[axis];
  // A later point edit or a redraw invalidates the quick sizing formula.
  return cached && typeof cached.radial === "boolean" && typeof cached.lower === "string"
    && typeof cached.size === "string" && Array.isArray(cached.coordinates)
    && cached.coordinates.length === sketch.points.length && axisSources(sketch, axis).every((s, i) => s === cached.coordinates[i])
    ? cached : undefined;
}
function validateBounds(radial: boolean, low: number, size: number) {
  if (radial && (low < 0 || size <= low))
    throw Error("Set the bore diameter to zero or more and the outside diameter above it.");
  if (!radial && size <= 0) throw Error("Enter a profile size greater than zero.");
}
export function validateProfileSizing(sketch: Sketch, values: Record<string, number>) {
  for (const axis of ["x", "y"] as const) {
    const range = matchingRange(sketch, axis);
    if (range) validateBounds(range.radial, evaluate(range.lower, values), evaluate(range.size, values));
  }
}

export function profileRange(sketch: Sketch, axis: Axis, turned: boolean, values: Record<string, number>,
  vertices?: ReadonlyArray<{ x: number; y: number }>): ProfileRange | undefined {
  if (sketch.points.length < 3) return;
  // Positive scaling preserves horizontal and vertical lines. Other relations
  // can prescribe angles, distances, radii or symmetry about a different datum.
  if (sketch.constraints.some((c) => !["horizontal", "vertical", "x", "y"].includes(c.type))) return;
  const source = axisSources(sketch, axis);
  const radial = turned && axis === "y";
  const cached = matchingRange(sketch, axis);
  const saved = cached?.radial === radial ? cached : undefined;
  if (!saved && (source.some((s) => constant(s) === undefined)
    || sketch.points.some((p) => constant(p[axis]) === undefined))) return;
  // Dragging one corner can leave its neighbors' free coordinate seeds behind.
  // The solved vertex order matches the sketch, even when those seeds differ.
  const coords = vertices ? vertices.map(p => p[axis]) : source.map(s => evaluate(s, values));
  const n = coords.length;
  if (!vertices && sketch.constraints.some((c) => c.type === (axis === "x" ? "vertical" : "horizontal")
      && Math.abs(coords[c.indices[0]] - coords[(c.indices[0] + 1) % n]) > 1e-8)) return;
  const min = Math.min(...coords), max = Math.max(...coords);
  if (radial && min < -1e-7 && max > 1e-7) return;
  const sign = radial && max <= 0 ? -1 : 1;
  const low = sign === 1 ? min : -max, high = sign === 1 ? max : -min;
  if (high - low < 1e-7) return;
  const fractions = coords.map(v => {
    const position = sign * v;
    if (Math.abs(position - low) < 1e-8) return 0;
    if (Math.abs(position - high) < 1e-8) return 1;
    return (position - low) / (high - low);
  });
  const hasBore = radial && fractions.some((f, i) => f === 0 && fractions[(i + 1) % n] === 0);
  return {
    axis, radial, sign, fractions, hasBore,
    lower: saved?.lower ?? mm(radial ? low * 2 : low),
    size: saved?.size ?? mm(radial ? high * 2 : high - low),
  };
}

// Each connected horizontal or vertical chain has one independent coordinate.
export function linkedCoordinateGroups(sketch: Sketch, axis: Axis): number[][] {
  const n = sketch.points.length;
  const relation = axis === "x" ? "vertical" : "horizontal";
  const edges = new Set(sketch.constraints.filter(c => c.type === relation).map(c => c.indices[0]));
  const seen = new Set<number>(), groups: number[][] = [];
  for (let start = 0; start < n; start++) {
    if (seen.has(start)) continue;
    const members = [start];
    seen.add(start);
    for (const i of members) {
      const prev = (i + n - 1) % n, next = (i + 1) % n;
      for (const [edge, neighbor] of [[prev, prev], [i, next]]) {
        if (!edges.has(edge) || seen.has(neighbor)) continue;
        members.push(neighbor);
        seen.add(neighbor);
      }
    }
    groups.push(members);
  }
  return groups;
}

export function changeProfileRange(sketch: Sketch, range: ProfileRange, field: "size" | "lower",
  expression: string, values: Record<string, number>): Sketch {
  const lower = field === "lower" ? expression : range.lower;
  const size = field === "size" ? expression : range.size;
  const lo = evaluate(lower, values), hi = evaluate(size, values);
  validateBounds(range.radial, lo, hi);

  const coordinates = range.fractions.map((f, i) => {
    const fraction = String(Number(f.toPrecision(15)));
    const coord = range.radial
      ? f === 0 ? lower : f === 1 ? size : `(${lower}) + ((${size}) - (${lower})) * ${fraction}`
      : f === 0 ? lower : f === 1 ? `(${lower}) + (${size})` : `(${lower}) + (${size}) * ${fraction}`;
    const formula = range.radial ? `(${coord}) * ${range.sign / 2}` : coord;
    const value = constant(formula);
    if (value === undefined) return formula;
    const number = String(Number(value.toPrecision(15)));
    return isExpression(sketch.points[i][range.axis]) ? number + " mm" : number;
  });
  const next = setProfileCoordinates(sketch, range.axis, coordinates, values);
  const saved: SavedRange = { radial: range.radial, lower, size, coordinates: axisSources(next, range.axis) };
  return { ...next, sizing: { ...sketch.sizing, [range.axis]: saved } };
}

/** Reuse the sketch's independent coordinate drivers, including dimensional constraints. */
export function setProfileCoordinates(sketch: Sketch, axis: Axis, coordinates: string[], values: Record<string, number>): Sketch {
  const locked = new Set(sketch.constraints.filter(c => c.type === axis).map(c => c.indices[0]));
  const points = sketch.points.map(p => ({ ...p }));
  for (const members of linkedCoordinateGroups(sketch, axis)) {
    // Prefer an explicit constraint or an existing expression. Duplicate formula
    // locks on both ends of a horizontal/vertical line overconstrain PlaneGCS.
    const driver = members.find(i => locked.has(i))
      ?? members.find(i => isExpression(sketch.points[i][axis])) ?? members[0];
    for (const i of members) {
      points[i][axis] = i === driver && !locked.has(i)
        ? coordinates[i] : String(evaluate(coordinates[i], values));
    }
  }
  const constraints = sketch.constraints.map(c => c.type === axis ? { ...c, value: coordinates[c.indices[0]] } : c);
  return { ...sketch, points, constraints };
}
