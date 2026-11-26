import { measureVolume, type Shape3D } from "replicad";
import { Matrix4, Quaternion, Vector3 } from "three";
import { collectFitSurfaces } from "./fitSurfaces";
import { positioned } from "./motionGeometry";
import type { RefillSeatSurface } from "./refillSeating";
import { isRigidTransform } from "./rigidTransform";
import { solidBounds } from "./secondaryProjection";

export function measureRefillSurfaces(body: Shape3D, id: string): RefillSeatSurface[] {
  const spans = new Map<string, [number, number]>();
  return collectFitSurfaces(body, id, true).map(surface => {
    if (surface.side !== "bore" || surface.axis.some(v => Math.abs(v - 1) < 1e-12)) return surface;
    const key = surface.axis.join(",");
    let span = spans.get(key);
    if (!span) {
      const rotation = new Quaternion().setFromUnitVectors(new Vector3(...surface.axis), new Vector3(1, 0, 0));
      const aligned = positioned(body, new Matrix4().makeRotationFromQuaternion(rotation).toArray());
      try {
        const [lo, hi] = solidBounds(aligned);
        span = [lo[0], hi[0]];
        spans.set(key, span);
      } finally { aligned.delete(); }
    }
    return { ...surface, axialBounds: span };
  });
}

/** B-rep volume common to the refill and its proposed host. Touching faces
 * (including a seated donor collar) have no volume. */
export function verifyRefillSeat(refill: Shape3D, host: Shape3D, relative: number[]) {
  if (!isRigidTransform(relative)) throw Error("Set a valid refill placement and try again.");
  const seated = positioned(refill, relative);
  try {
    const common = seated.intersect(host);
    try {
      const volume = Math.abs(measureVolume(common));
      if (!Number.isFinite(volume)) throw Error("Turnmill could not measure the refill at this opening.");
      if (volume > 1e-7) throw Error("The seated refill overlaps the part. Check the bore diameter, internal shoulders and available depth.");
    } finally { common.delete(); }
  } finally { seated.delete(); }
}
