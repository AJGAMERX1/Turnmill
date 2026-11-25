import { Vector3 } from "three";
import type { ProjectedView } from "./secondaryProjection";
import type { XY } from "./secondaryVector";
import type { XYZ } from "./assemblyDrawingProjection";
import type { JointKind } from "./kinematics";

export type DrawingComponent = {
  id: string;
  name: string;
  parent: string;
  kind: JointKind;
  center: XYZ;
  size: XYZ;
  axis: XYZ;
  view: ProjectedView;
};
export type ExplosionAxis = "joints" | "X" | "Y" | "Z";
export type ExplosionOptions = { axis?: ExplosionAxis; gap?: number };
export type ExplodedComponent = DrawingComponent & {
  offset: XYZ;
  shift: XY;
  bounds: [XY, XY];
};
const right = new Vector3(1, 1, 0).normalize(),
  up = new Vector3(1, -1, 1).normalize().cross(right);
const project = (v: Vector3): XY => [v.dot(right), v.dot(up)];
const worldAxis = (index: number) => new Vector3().setComponent(index, 1);
const center = (p: DrawingComponent) => new Vector3(...p.center);

function direction(
  part: DrawingComponent,
  parent: DrawingComponent,
  axis: ExplosionAxis,
) {
  const radial = center(part).sub(center(parent));
  let d: Vector3;
  if (axis !== "joints") d = worldAxis(["X", "Y", "Z"].indexOf(axis));
  else if (
    part.kind === "screw" ||
    part.kind === "slider" ||
    part.kind === "cylindrical" ||
    part.kind === "revolute"
  )
    d = new Vector3(...part.axis);
  else {
    // Fixed accessories on a spindle (such as the pocket clip) lift off radially.
    const axial = new Vector3(...parent.axis);
    d = radial.clone().addScaledVector(axial, -radial.dot(axial));
    if (d.length() < 1e-6) d = radial.clone();
    if (d.length() < 1e-6) d = new Vector3(0, 0, 1);
  }
  if (d.dot(radial) < 0) d.negate();
  d.normalize();
  if (Math.hypot(...project(d)) < 1e-5) d.copy(right);
  return d;
}

function forbiddenRange(box: [XY, XY], obstacle: [XY, XY], v: XY, gap: number) {
  let entry = -Infinity,
    exit = Infinity;
  for (const k of [0, 1]) {
    const a = obstacle[0][k] - gap - box[1][k],
      b = obstacle[1][k] + gap - box[0][k];
    if (Math.abs(v[k]) < 1e-10) {
      if (a > 0 || b < 0) return null;
    } else {
      entry = Math.max(entry, Math.min(a / v[k], b / v[k]));
      exit = Math.min(exit, Math.max(a / v[k], b / v[k]));
    }
  }
  return entry <= exit && exit >= 0 ? [entry, exit] : null;
}
function shiftBounds(bounds: [XY, XY], by: XY): [XY, XY] {
  return [
    [bounds[0][0] + by[0], bounds[0][1] + by[1]],
    [bounds[1][0] + by[0], bounds[1][1] + by[1]],
  ];
}
/** Orthographic projection commutes with a 3D translation. Keeping the projected
 * boxes disjoint allows each component's visible edges to be reused exactly. */
export function explodeAssembly(
  parts: DrawingComponent[],
  options: ExplosionOptions = {},
): ExplodedComponent[] {
  if (!parts.length) return [];
  const axis = options.axis ?? "joints";
  if (!["joints", "X", "Y", "Z"].includes(axis))
    throw Error("Choose a valid explosion direction.");
  const maxSize = Math.max(...parts.map((p) => Math.max(...p.size)));
  const gap = options.gap ?? Math.max(maxSize * 0.075, 1);
  if (!(gap > 0 && Number.isFinite(gap)))
    throw Error("The explosion gap must be a positive length.");
  const known = new Map(parts.map((p) => [p.id, p])),
    placed = new Map<string, ExplodedComponent>(),
    visiting = new Set<string>();
  const roots = parts.filter((p) => !known.has(p.parent));
  const anchor = (roots.length ? roots : parts).reduce((best, p) =>
    Math.hypot(...p.size) > Math.hypot(...best.size) ? p : best,
  );
  function place(part: DrawingComponent): ExplodedComponent {
    const current = placed.get(part.id);
    if (current) return current;
    if (visiting.has(part.id))
      throw Error(
        "Repair the joint parent loop before creating an exploded view.",
      );
    visiting.add(part.id);
    const offset = new Vector3();
    if (part !== anchor) {
      const parent = known.get(part.parent) ?? anchor;
      const basis = place(parent);
      const vector = direction(part, parent, axis),
        planar = project(vector);
      offset.fromArray(basis.offset);
      const initial = shiftBounds(part.view.bounds, project(offset));
      const intervals = Array.from(placed.values())
        .map((p) => forbiddenRange(initial, p.bounds, planar, gap))
        .filter((r): r is number[] => r !== null)
        .sort((a, b) => a[0] - b[0]);
      let step = gap / Math.hypot(...planar);
      for (const [entry, exit] of intervals) {
        if (entry > step) break;
        if (exit >= step) step = exit + Math.max(1e-7, gap * 1e-8);
      }
      offset.addScaledVector(vector, step);
    }
    const shift = project(offset),
      record = {
        ...part,
        offset: offset.toArray() as XYZ,
        shift,
        bounds: shiftBounds(part.view.bounds, shift),
      };
    placed.set(part.id, record);
    visiting.delete(part.id);
    return record;
  }
  place(anchor);
  return parts.map(place);
}
