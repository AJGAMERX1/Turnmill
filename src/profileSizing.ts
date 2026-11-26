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

function matchingRange(sketch: Sketch, axis: Axis) {
  const cached = sketch.sizing?.[axis];
  // A later point edit or a redraw invalidates the quick sizing formula.
  return cached && typeof cached.radial === "boolean" && typeof cached.lower === "string"
    && typeof cached.size === "string" && Array.isArray(cached.coordinates)
    && cached.coordinates.length === sketch.points.length && sketch.points.every((p, i) => p[axis] === cached.coordinates[i])
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

export function profileRange(sketch: Sketch, axis: Axis, turned: boolean, values: Record<string, number>): ProfileRange | undefined {
  if (sketch.points.length < 3) return;
  // Positive scaling preserves horizontal and vertical lines. Other relations
  // can prescribe angles, distances, radii or symmetry about a different datum.
  if (sketch.constraints.some((c) => c.type !== "horizontal" && c.type !== "vertical"
      && c.type !== (axis === "x" ? "y" : "x"))) return;
  const source = sketch.points.map((p) => p[axis]);
  const radial = turned && axis === "y";
  const cached = matchingRange(sketch, axis);
  const saved = cached?.radial === radial ? cached : undefined;
  if (!saved && source.some((s) => constant(s) === undefined)) return;
  const coords = source.map((s) => evaluate(s, values));
  const n = coords.length;
  if (sketch.constraints.some((c) => c.type === (axis === "x" ? "vertical" : "horizontal")
      && Math.abs(coords[c.indices[0]] - coords[(c.indices[0] + 1) % n]) > 1e-8)) return;
  const min = Math.min(...coords), max = Math.max(...coords);
  if (radial && min < -1e-7 && max > 1e-7) return;
  const sign = radial && max <= 0 ? -1 : 1;
  const low = sign === 1 ? min : -max, high = sign === 1 ? max : -min;
  if (high - low < 1e-7) return;
  const fractions = coords.map((v) => (sign * v - low) / (high - low));
  const hasBore = radial && fractions.some((f, i) => f === 0 && fractions[(i + 1) % n] === 0);
  return {
    axis, radial, sign, fractions, hasBore,
    lower: saved?.lower ?? mm(radial ? low * 2 : low),
    size: saved?.size ?? mm(radial ? high * 2 : high - low),
  };
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
  const saved: SavedRange = { radial: range.radial, lower, size, coordinates };
  return {
    ...sketch,
    points: sketch.points.map((p, i) => ({ ...p, [range.axis]: coordinates[i] })),
    sizing: { ...sketch.sizing, [range.axis]: saved },
  };
}
