import type { Matrix4 } from "three";
import { defaultJoint, isFloating, type Joint, type JointConfig } from "./kinematics";
import { isRigidTransform } from "./rigidTransform";

export function canSnapRefill(joint?: Joint): boolean {
  return isFloating(joint) || (joint?.kind === "fixed" && !!joint.parent && joint.refillSnap === true);
}

/** The mount maps the refill's model coordinates into the selected barrel's model coordinates. */
export function makeRefillSnapJoint(config: JointConfig, refillId: string, barrelId: string, local: Matrix4): Joint {
  if (!canSnapRefill(config[refillId]))
    throw Error("This refill already has a joint. Float it at its current position before snapping it to another part.");
  if (!barrelId || !refillId || refillId === barrelId) throw Error("Choose a bore on a different part.");
  const visited = new Set([refillId]);
  for (let id = barrelId; id; id = config[id]?.parent) {
    if (visited.has(id)) throw Error("This part already follows the refill. Choose another barrel to avoid a joint loop.");
    visited.add(id);
  }
  const mount = local.toArray();
  if (!isRigidTransform(mount)) throw Error("This opening has an invalid placement. Choose another bore.");
  return { ...defaultJoint(), parent: barrelId, refillSnap: true, mount };
}
