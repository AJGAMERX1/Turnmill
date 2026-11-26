import { Matrix4, Vector3 } from "three";
import type { FitSurface } from "./fitSurfaces";

// Millimetres. This only absorbs round-off in CAD geometry and rigid poses.
const epsilon = 1e-6;
export function diametralFit(boreDiameter: number, refillDiameter: number) {
  if (![boreDiameter, refillDiameter].every(n => Number.isFinite(n) && n > 0))
    throw Error("Enter a positive diameter for the bore and refill.");
  const difference = boreDiameter - refillDiameter;
  const clearance = Math.abs(difference) <= epsilon ? 0 : difference;
  const status = clearance < 0 ? "interference" : clearance === 0 ? "line-to-line" : "clearance";
  return { clearance, status } as const;
}

export type RefillBoreCheck = ReturnType<typeof diametralFit> & {
  bodyId: string;
  boreKey: string;
  boreDiameter: number;
  refillDiameter: number;
};

function posedLand(surface: FitSurface, matrix: Matrix4) {
  const local = new Vector3(...surface.axis);
  const endAt = (station: number) => new Vector3(...surface.centerline)
    .addScaledVector(local, station).applyMatrix4(matrix);
  return {
    axis: local.clone().transformDirection(matrix),
    start: endAt(surface.start),
    end: endAt(surface.end),
    diameter: surface.diameter,
    endDiameter: surface.endDiameter ?? surface.diameter,
  };
}

type Land = ReturnType<typeof posedLand>;
function overlappingDiameter(bore: Land, shaft: Land) {
  if (bore.axis.clone().cross(shaft.axis).length() > 1e-7) return 0;
  const fromStart = shaft.start.clone().sub(bore.start);
  if (fromStart.clone().cross(bore.axis).length() > epsilon) return 0;
  const a = fromStart.dot(bore.axis);
  const b = shaft.end.clone().sub(bore.start).dot(bore.axis);
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(bore.start.distanceTo(bore.end), Math.max(a, b));
  if (hi - lo <= epsilon) return 0;
  const diameterAt = (x: number) => shaft.diameter +
    (shaft.endDiameter - shaft.diameter) * ((x - a) / (b - a));
  return Math.max(diameterAt(lo), diameterAt(hi));
}

/** Nominal diametral checks on complete cylindrical bores, measured at the overlapping lands and tapers of the refill. */
export function refillBoreChecks(
  refillId: string, bodyIds: string[], surfaces: FitSurface[][], matrices: number[][],
): RefillBoreCheck[] {
  const i = bodyIds.indexOf(refillId);
  if (i === -1 || matrices.length !== bodyIds.length || surfaces.length !== bodyIds.length) return [];
  const refillPose = new Matrix4().fromArray(matrices[i]);
  const shafts = surfaces[i].filter(s => s.side === "shaft").map(s => posedLand(s, refillPose));
  const checks: RefillBoreCheck[] = [];
  surfaces.forEach((lands, j) => {
    if (i === j) return;
    const matrix = new Matrix4().fromArray(matrices[j]);
    for (const s of lands) {
      if (s.side !== "bore") continue;
      const bore = posedLand(s, matrix);
      let refillDiameter = 0;
      for (const shaft of shafts) {
        refillDiameter = Math.max(refillDiameter, overlappingDiameter(bore, shaft));
      }
      if (refillDiameter)
        checks.push({ bodyId: bodyIds[j], boreKey: s.key, boreDiameter: s.diameter, refillDiameter,
          ...diametralFit(s.diameter, refillDiameter) });
    }
  });
  return checks.sort((a, b) => a.clearance - b.clearance);
}
