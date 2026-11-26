import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import type { RefillBackingPlan } from "./refillBacking";
import { solidBounds } from "./secondaryProjection";

/** Check the straight boring tool against only the finished barrel. The removable
 * cone comes off before machining or loading the cartridge. A blind backing must
 * reach its existing floor. Open bores need access to both sides of the shoulder. */
export function verifyRefillBackingStock(barrel: Shape3D, plan: RefillBackingPlan) {
  if (plan.kind === "existing") return;
  const { centerline, boreDiameter } = plan;
  const axis = plan.axis === "X" ? 0 : 2;
  const sign = Math.sign(plan.backStation - plan.faceStation);
  const [lo,hi] = solidBounds(barrel);
  const front = (sign > 0 ? lo : hi)[axis], rear = (sign > 0 ? hi : lo)[axis];
  function clear(from: number, to: number) {
    const length = Math.abs(to - from);
    if (length <= 1e-7) return true;
    const origin: [number, number, number] = [...centerline];
    const direction: [number, number, number] = [0,0,0];
    origin[axis] = from;
    direction[axis] = Math.sign(to - from);
    const tool = makeCylinder(boreDiameter / 2, length, origin, direction);
    try {
      const occupied = barrel.intersect(tool);
      try { return Math.abs(measureVolume(occupied)) <= 1e-7; }
      finally { occupied.delete(); }
    } finally { tool.delete(); }
  }
  if (!clear(front, plan.faceStation))
    throw Error("The barrel has a narrower passage in front of this stop. Open the front machining path or edit the original bore to form the stop.");
  if (!clear(plan.faceStation, plan.backStation))
    throw Error("An existing internal feature occupies the proposed backing. Move the stop onto a clear bore land or edit the original barrel.");
  if (plan.openRear && !clear(plan.backStation, rear))
    throw Error("A narrower rear passage blocks the tool path to the back of this shoulder. Open the rear bore or choose an accessible stop location.");
}
