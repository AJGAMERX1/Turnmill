import { measureShapeSurfaceProperties, type Shape3D } from "replicad";

type XYZ = [number, number, number];
export type FitSurface = {
  key: string;
  bodyId: string;
  side: "bore" | "shaft";
  diameter: number;
  axis: XYZ;
  centerline: XYZ;
  start: number;
  end: number;
};
const rounded = (value: number) => Number(value.toFixed(6));
const dot = (a: XYZ, b: XYZ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Group same-domain faces so STEP files with split cylinders remain selectable.
 * Only a complete cylindrical land qualifies as a smooth size feature. */
export function collectFitSurfaces(
  shape: Shape3D,
  bodyId: string,
): FitSurface[] {
  const groups = new Map<string, { surface: FitSurface; area: number }>();
  const faces = shape.faces;
  try {
    for (const face of faces) {
      if (face.geomType !== "CYLINDRE") continue;
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
  return candidates.sort(
    (a, b) => a.start - b.start || a.diameter - b.diameter,
  );
}
