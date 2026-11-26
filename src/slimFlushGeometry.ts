import type { Shape3D } from "replicad";
import { Matrix4, Vector3 } from "three";
import type { Body } from "./geometry";
import type { Joint } from "./kinematics";
import { findThread, type ThreadFrame } from "./threadMates";
import { endRadii } from "./threadPreparation";

function shoulderRim(shape: Shape3D, frame: ThreadFrame) {
  const axis = frame.axis === "X" ? 0 : 2;
  const outward = frame.end === "end" ? 1 : -1;
  const center: [number, number, number] = [...frame.entrance];
  if (frame.side === "external") center[axis] -= outward * frame.length;
  const faces = shape.faces;
  try {
    let diameter = 0;
    for (const face of faces) {
      if (face.geomType !== "PLANE") continue;
      const normal = face.normalAt();
      try { if (normal.toTuple()[axis] * outward < 1 - 1e-8) continue; }
      finally { normal.delete(); }
      // Modeled tooth exits can split the inner edge of a flat seating face.
      // Its complete outer perimeter is the visible seam where the diameters meet.
      const outer = face.outerWire();
      try {
        const ring = endRadii(outer, { axis, center, endCoord: center[axis] });
        if (ring) diameter = Math.max(diameter, 2 * ring.outer);
      } finally { outer.delete(); }
    }
    if (!diameter) throw Error("The cap needs a complete round seating rim on the barrel and its mouth. Move the thread clear of tapers, flutes or broken edges.");
    return { center, diameter };
  } finally { faces.forEach(f => f.delete()); }
}

/** Match both finished rims at this installed position, including stepped barrels. */
export function verifySlimFlush(barrel: Body, cap: Body, joint: Pick<Joint, "parent" | "threadMate">,
  barrelMatrix: number[], capMatrix: number[]) {
  const socket = cap.threadFrames?.find(f => f.featureId === joint.threadMate?.moving.featureId && f.finishId === joint.threadMate?.moving.finishId);
  const post = findThread(barrel.threadFrames ?? [], joint.parent, joint.threadMate?.mating);
  if (!socket || socket.side !== "internal" || !post || post.side !== "external")
    throw Error("Restore both sides of the cap's thread connection before checking flush fit.");
  const a = shoulderRim(barrel.shape, post), b = shoulderRim(cap.shape, socket);
  const world = (point: number[], matrix: number[]) => new Vector3().fromArray(point).applyMatrix4(new Matrix4().fromArray(matrix));
  if (world(a.center, barrelMatrix).distanceTo(world(b.center, capMatrix)) > 1e-5)
    throw Error("The cap mouth does not meet the barrel shoulder. Fully seat the cap before sizing the pen.");
  if (Math.abs(a.diameter - b.diameter) > 1e-5) {
    const display = (n: number) => "Ø" + Number(n.toFixed(4)) + " mm";
    throw Error("At the " + post.end + " of the barrel the cap is " + display(b.diameter) +
      " and its shoulder is " + display(a.diameter) + ". Give both end shoulders the cap's outside diameter for a flush joint.");
  }
}
