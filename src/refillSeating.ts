import { Matrix4, Quaternion, Vector3 } from "three";
import type { FitSurface } from "./fitSurfaces";
import { refillBoreChecks } from "./refillClearance";
import { isSleeveDonor, refillComponents, refillDimensions } from "./refills";
import type { Project } from "./types";

type XYZ = [number, number, number];
export type RefillBodyBounds = [XYZ, XYZ];
export type RefillSeatSurface = FitSurface & { axialBounds?: [number, number] };
export type RefillOpening = Pick<FitSurface, "bodyId" | "axis" | "centerline" | "diameter"> & {
  key: string;
  end: "start" | "end";
  station: number;
};

const tolerance = 1e-5;

/** Only an uninterrupted bore that reaches the outside end plane is a mouth.
 * This keeps an internal counterbore shoulder or a blind bottom out of the picker. */
export function refillOpenings(surfaces: RefillSeatSurface[], bounds: RefillBodyBounds): RefillOpening[] {
  const openings: RefillOpening[] = [];
  for (const s of surfaces) {
    if (s.side !== "bore") continue;
    // Native turned and drilled bores run along a coordinate axis. An imported
    // bore can be oblique; the worker measures that body's bounds along its axis.
    const i = s.axis.findIndex(v => Math.abs(v - 1) < 1e-12);
    const stations = s.axialBounds ?? (i >= 0 ? [bounds[0][i], bounds[1][i]] : undefined);
    if (!stations) continue;
    for (const end of ["start", "end"] as const) {
      const station = s[end];
      if (Math.abs(station - stations[end === "start" ? 0 : 1]) > tolerance) continue;
      openings.push({ bodyId: s.bodyId, axis: s.axis, centerline: s.centerline, diameter: s.diameter,
        key: s.key + ":" + end, end, station });
    }
  }
  return openings;
}

/** Refill-local to host-local rigid transform. The positive bore direction at
 * the chosen end runs from the writing point toward the tail inside the host. */
export function seatRefill(project: Project, refillId: string, opening: RefillOpening, tipExposure = 2): Matrix4 {
  const refill = refillComponents(project).find(r => r.bodyId === refillId);
  const d = refillDimensions(project, refillId);
  if (!refill || !d || !(d.length > 0)) throw Error("Choose an installed refill with a positive tip-to-tail length.");
  if (refill.bodyId === opening.bodyId) throw Error("Choose a different part to hold the refill.");
  const donor = isSleeveDonor(refill.kind);
  if (donor && opening.diameter >= d.collar_diameter - tolerance)
    throw Error("The donor’s stop collar would pass through this opening. Choose a smaller bore or add a shoulder for the collar.");
  const exposure = donor ? d.seat_distance : tipExposure;
  if (!Number.isFinite(exposure) || exposure < 0 || exposure >= d.length)
    throw Error("Set the tip exposure between zero and the tip-to-tail length, leaving some refill inside the bore.");

  const inward = new Vector3(...opening.axis).multiplyScalar(opening.end === "start" ? 1 : -1);
  const writingPoint = new Vector3(...opening.centerline)
    .addScaledVector(new Vector3(...opening.axis), opening.station)
    .addScaledVector(inward, -exposure);
  // Reversed catalog solids put their writing point at local X=length and their tail at X=0.
  const cartridgeDirection = new Vector3(refill.reversed ? -1 : 1, 0, 0);
  const rotation = new Quaternion().setFromUnitVectors(cartridgeDirection, inward);
  const localTip = new Vector3(refill.reversed ? d.length : 0, 0, 0).applyQuaternion(rotation);
  return new Matrix4().makeRotationFromQuaternion(rotation).setPosition(writingPoint.sub(localTip));
}

export function refillSnapClearance(refill: FitSurface[], target: FitSurface[], relative: Matrix4) {
  if (!refill.length || !target.length) return;
  return refillBoreChecks(refill[0].bodyId, [refill[0].bodyId, target[0].bodyId], [refill, target],
    [relative.toArray(), new Matrix4().toArray()])[0];
}
