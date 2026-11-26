import { measureShapeSurfaceProperties, type Face, type Shape3D } from "replicad";

type XYZ = [number, number, number];
export type FitSurface = {
  key: string;
  bodyId: string;
  side: "bore" | "shaft";
  diameter: number;
  /** At the end station of a measured outer taper, otherwise constant. */
  endDiameter?: number;
  axis: XYZ;
  centerline: XYZ;
  start: number;
  end: number;
};
const rounded = (value: number) => Number(value.toFixed(6));
const dot = (a: XYZ, b: XYZ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The browser kernel exposes parametric evaluation of cones but has no bound gp_Cone.
 * Opposite points on each end circle give its exact center and diameter, including an apex. */
function outerTaper(face: Face, bodyId: string): FitSurface | undefined {
  const { uMin, uMax } = face.UVBounds;
  if (Math.abs(uMax - uMin - 2 * Math.PI) > 1e-7) return;
  const endRing = (v: number) => {
    const a = face.pointOnSurface(0, v), b = face.pointOnSurface(0.5, v);
    try {
      const p = a.toTuple(), q = b.toTuple();
      return { center: p.map((n, i) => (n + q[i]) / 2) as XYZ,
        diameter: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) };
    } finally { a.delete(); b.delete(); }
  };
  const a = endRing(0), b = endRing(1);
  const delta = b.center.map((n, i) => n - a.center[i]) as XYZ;
  const height = Math.hypot(...delta);
  if (height <= 1e-6) return;
  const slant = Math.hypot(height, (b.diameter - a.diameter) / 2);
  const area = Math.PI * (a.diameter + b.diameter) / 2 * slant;
  const measured = measureShapeSurfaceProperties(face);
  try {
    if (Math.abs(measured.area - area) > Math.max(1e-8, area * 1e-6)) return;
  } finally { measured.delete(); }
  const axis = delta.map(n => n / height) as XYZ;
  const start = dot(a.center, axis);
  const centerline = a.center.map((n, i) => n - start * axis[i]) as XYZ;
  const sample = face.pointOnSurface(.25, .5), normal = face.normalAt(sample);
  try {
    const q = sample.toTuple(), t = dot(q, axis);
    const radial = q.map((n, i) => n - centerline[i] - t * axis[i]) as XYZ;
    if (dot(radial, normal.toTuple()) <= 0) return;
  } finally { sample.delete(); normal.delete(); }
  return { bodyId, side: "shaft", axis, centerline, start, end: start + height,
    diameter: a.diameter, endDiameter: b.diameter,
    key: JSON.stringify([bodyId, "taper", ...a.center.map(rounded), ...b.center.map(rounded)]) };
}

/** Group same-domain faces so STEP files with split cylinders remain selectable.
 * Only a complete cylindrical land qualifies as a smooth size feature. */
export function collectFitSurfaces(
  shape: Shape3D,
  bodyId: string,
  includeOuterTapers = false,
): FitSurface[] {
  const tapers: FitSurface[] = [];
  const groups = new Map<string, { surface: FitSurface; area: number }>();
  const faces = shape.faces;
  try {
    for (const face of faces) {
      const type = face.geomType;
      if (includeOuterTapers && type === "CONE") {
        try { const taper = outerTaper(face, bodyId); if (taper) tapers.push(taper); }
        catch { /* Incomplete or singular imported faces cannot provide a size reference. */ }
      }
      if (type !== "CYLINDRE") continue;
      const surface = face.surface,
        cylinder = surface.wrapped.Cylinder(),
        line = cylinder.Axis(),
        dir = line.Direction(),
        loc = line.Location();
      try {
        const axis: XYZ = [dir.X(), dir.Y(), dir.Z()];
        const origin: XYZ = [loc.X(), loc.Y(), loc.Z()];
        // Fix direction for geometry references even when STEP swaps the parameterization.
        const sign = (axis.find((v) => Math.abs(v) > 1e-7) ?? 1) < 0 ? -1 : 1;
        for (let i = 0; i < 3; i++) axis[i] *= sign;
        const station = dot(origin, axis);
        const centerline: XYZ = [
          origin[0] - station * axis[0],
          origin[1] - station * axis[1],
          origin[2] - station * axis[2],
        ];
        const sample = face.pointOnSurface(0.31, 0.53),
          normal = face.normalAt(sample);
        let side: "bore" | "shaft";
        try {
          const point = sample.toTuple(),
            t = dot(point, axis);
          const radial: XYZ = [
            point[0] - centerline[0] - t * axis[0],
            point[1] - centerline[1] - t * axis[1],
            point[2] - centerline[2] - t * axis[2],
          ];
          const outward = dot(radial, normal.toTuple()) / cylinder.Radius();
          if (Math.abs(outward) < 0.99999) continue;
          side = outward < 0 ? "bore" : "shaft";
        } finally {
          normal.delete();
          sample.delete();
        }
        const { vMin, vMax } = face.UVBounds;
        const start = station + (sign === 1 ? vMin : -vMax),
          end = station + (sign === 1 ? vMax : -vMin);
        const diameter = cylinder.Radius() * 2;
        if (
          ![diameter, start, end].every(Number.isFinite) ||
          end - start <= 1e-6
        )
          continue;
        const key = JSON.stringify([
          bodyId,
          side,
          ...[...axis, ...centerline, start, end].map(rounded),
        ]);
        const exactKey = key + "/" + rounded(diameter);
        const entry = groups.get(exactKey) ?? {
          surface: {
            key,
            bodyId,
            side,
            diameter,
            axis,
            centerline,
            start,
            end,
          },
          area: 0,
        };
        const measured = measureShapeSurfaceProperties(face);
        try {
          entry.area += measured.area;
        } finally {
          measured.delete();
        }
        groups.set(exactKey, entry);
      } catch {
        // Some imported trimmed faces have singular normals. Other lands on
        // the part remain available even when this face cannot be measured.
        continue;
      } finally {
        loc.delete();
        dir.delete();
        line.delete();
        cylinder.delete();
        surface.delete();
      }
    }
  } finally {
    faces.forEach((face) => face.delete());
  }
  const candidates: FitSurface[] = [];
  const counts = new Map<string, number>();
  for (const { surface, area } of groups.values()) {
    const expected = Math.PI * surface.diameter * (surface.end - surface.start);
    if (Math.abs(area - expected) > Math.max(1e-8, expected * 1e-6)) continue;
    candidates.push(surface);
    counts.set(surface.key, (counts.get(surface.key) ?? 0) + 1);
  }
  // A single uninterrupted land at a station keeps its reference as its diameter
  // changes. Concentric lands spanning the same interval also need the diameter.
  for (const surface of candidates)
    if (counts.get(surface.key)! > 1)
      surface.key += "/" + rounded(surface.diameter);
  return [...candidates, ...tapers].sort(
    (a, b) => a.start - b.start || a.diameter - b.diameter,
  );
}
