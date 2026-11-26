import { Matrix4, Quaternion, Vector3 } from "three";
import { evaluate } from "./expressions";
import type { JointConfig } from "./kinematics";

export type ThreadRef = { featureId: string; finishId: string };
export type ThreadFrame = ThreadRef & {
  bodyId: string;
  autoFit?: string;
  name: string;
  axis: "X" | "Z";
  entrance: [number, number, number];
  end: "start" | "end";
  side: "internal" | "external";
  hand: "right" | "left";
  mode: "modeled" | "cosmetic";
  pitch: number;
  length: number;
  diameter: number;
};
export type ThreadMate = {
  moving: ThreadRef;
  mating: ThreadRef;
  placement: "modeled" | "entrances";
  engagement: string;
  phase: string;
};
const direction = (f: ThreadFrame) =>
  new Vector3(f.axis === "X" ? 1 : 0, 0, f.axis === "Z" ? 1 : 0);
export function findThread(
  frames: ThreadFrame[],
  bodyId: string,
  ref: ThreadRef | undefined,
) {
  return (
    ref &&
    frames.find(
      (f) =>
        f.bodyId === bodyId &&
        f.featureId === ref.featureId &&
        f.finishId === ref.finishId,
    )
  );
}
export function canKeepPlacement(a: ThreadFrame, b: ThreadFrame) {
  const transverse = new Vector3(...a.entrance)
    .sub(new Vector3(...b.entrance))
    .cross(direction(a));
  return a.axis === b.axis && a.end !== b.end && transverse.length() < 1e-5;
}
export function resolveThreadMates(
  config: JointConfig,
  frames: ThreadFrame[],
  values: Record<string, number>,
  activeIds: string[],
): JointConfig {
  const resolved = { ...config };
  for (const [id, joint] of Object.entries(config)) {
    const mate = joint.threadMate;
    if (!mate || !activeIds.includes(id)) continue;
    const a = findThread(frames, id, mate.moving),
      b = findThread(frames, joint.parent, mate.mating);
    if (!a || !b)
      throw Error(
        "A linked thread is missing. Restore its finish or edit the thread connection.",
      );
    if (a.bodyId === b.bodyId || a.side === b.side)
      throw Error(
        "Choose an internal and an external thread on different parts.",
      );
    if (Math.abs(a.pitch - b.pitch) > 1e-7 || a.hand !== b.hand)
      throw Error(
        "The two threads need the same pitch and hand. Edit a finish or choose another thread.",
      );
    const internal = a.side === "internal" ? a : b,
      external = a.side === "external" ? a : b;
    if (
      internal.diameter - 2 * ((5 * Math.sqrt(3)) / 16) * internal.pitch >=
      external.diameter
    )
      throw Error(
        "These thread diameters leave the flanks apart. Choose a pair whose diameters can engage.",
      );
    const axis = direction(a),
      entrance = new Vector3(...a.entrance);
    const rotation = new Quaternion();
    let target = entrance.clone();
    if (mate.placement === "modeled") {
      if (!canKeepPlacement(a, b))
        throw Error(
          "These entrance axes do not face each other on the same centerline. Choose Align entrances.",
        );
    } else if (mate.placement === "entrances") {
      const parentAxis = direction(b),
        depth = evaluate(mate.engagement, values);
      target = new Vector3(...b.entrance).addScaledVector(
        parentAxis,
        (b.end === "start" ? 1 : -1) * depth,
      );
      rotation.setFromUnitVectors(
        axis,
        parentAxis.multiplyScalar(a.end === b.end ? -1 : 1),
      );
    } else throw Error("Choose how to place the thread entrances.");
    const phase = evaluate(mate.phase, values, "angle");
    rotation.multiply(
      new Quaternion().setFromAxisAngle(axis, (phase * Math.PI) / 180),
    );
    const rest = new Matrix4().makeRotationFromQuaternion(rotation);
    rest.setPosition(target.sub(entrance.clone().applyQuaternion(rotation)));
    resolved[id] = {
      ...joint,
      kind: "screw",
      axis: a.axis,
      origin: a.entrance.map(String) as [string, string, string],
      offset: ["0", "0", "0"],
      pitch: String(a.pitch),
      starts: "1",
      hand: a.hand === "right" ? 1 : -1,
      mount: rest.toArray(),
    };
  }
  return resolved;
}
