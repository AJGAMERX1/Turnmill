import type { Shape3D } from "replicad";
export type TurningStation = {
  diameter: number;
  xMin: number;
  xMax: number;
  side: "external" | "internal" | "unknown";
};

/** X-axis cylinders only. Axial bounds refer to the surviving (possibly trimmed) face. */
export function getTurningStations(shape: Shape3D): TurningStation[] {
  const faces = shape.faces,
    unique = new Map<string, TurningStation>();
  try {
    for (const face of faces) {
      if (face.geomType !== "CYLINDRE") continue;
      const surface = face.surface,
        cylinder = surface.wrapped.Cylinder(),
        axis = cylinder.Axis();
      const direction = axis.Direction(),
        location = axis.Location();
      const coaxial =
        Math.abs(direction.X()) > 1 - 1e-9 &&
        Math.hypot(location.Y(), location.Z()) < 1e-6;
      const diameter = 2 * cylinder.Radius();
      direction.delete();
      location.delete();
      axis.delete();
      cylinder.delete();
      surface.delete();
      if (!coaxial) continue;
      const box = face.boundingBox,
        [[xMin], [xMax]] = box.bounds;
      box.delete();
      const sample = face.pointOnSurface(0.43, 0.51),
        normal = face.normalAt(sample);
      const [, y, z] = sample.toTuple(),
        [, ny, nz] = normal.toTuple();
      sample.delete();
      normal.delete();
      const dot = (ny * y + nz * z) / (diameter / 2);
      const side =
        dot > 0.999 ? "external" : dot < -0.999 ? "internal" : "unknown";
      const key = [
        side,
        ...[diameter, xMin, xMax].map((n) => Number(n.toFixed(6))),
      ].join("/");
      unique.set(key, { diameter, xMin, xMax, side });
    }
  } finally {
    faces.forEach((f) => f.delete());
  }
  return [...unique.values()].sort(
    (a, b) => a.xMin - b.xMin || a.diameter - b.diameter,
  );
}
