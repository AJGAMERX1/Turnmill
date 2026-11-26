import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { Matrix4, Vector3 } from "three";
import { threadMinorDiameter } from "./finishingTypes";
import { isRigidTransform } from "./rigidTransform";
import { positioned } from "./motionGeometry";
import { findThread, resolveThreadMates, type ThreadFrame } from "./threadMates";
import { buildPoses, type Joint } from "./kinematics";
import type { Body } from "./geometry";
import { resolveParameters } from "./expressions";
import { setCapMount } from "./threadedCone";
import type { Project } from "./types";

type CapJoint = Pick<Joint, "parent" | "threadMate">;
type XYZ = [number, number, number];
const margin = 1e-7;
const inward = (frame: ThreadFrame) => new Vector3(frame.axis === "X" ? 1 : 0, 0, frame.axis === "Z" ? 1 : 0)
  .multiplyScalar(frame.end === "start" ? 1 : -1);

// Cosmetic threads retain solid pilot stock. Discount only the shared tooth
// envelope of the two referenced, coaxial threads, in cap-local coordinates.
function cosmeticTeeth(socket: ThreadFrame, tenon: ThreadFrame, hostToCap: Matrix4): Shape3D | undefined {
  if (socket.mode === "modeled" && tenon.mode === "modeled") return;
  if (socket.side !== "internal" || tenon.side !== "external" || socket.hand !== tenon.hand
      || Math.abs(socket.pitch - tenon.pitch) > margin || tenon.diameter > socket.diameter + margin) return;
  const axis = inward(socket), origin = new Vector3(...socket.entrance);
  const maleAxis = inward(tenon).transformDirection(hostToCap);
  const delta = new Vector3(...tenon.entrance).applyMatrix4(hostToCap).sub(origin);
  const first = delta.dot(axis), last = first + maleAxis.dot(axis) * tenon.length;
  if (Math.abs(maleAxis.dot(axis)) < 1 - 1e-10 || delta.addScaledVector(axis, -first).length() > 1e-6) return;
  const lo = Math.max(0, Math.min(first, last)), hi = Math.min(socket.length, Math.max(first, last));
  const minor = threadMinorDiameter(socket.diameter, socket.pitch) / 2, major = tenon.diameter / 2;
  if (hi - lo <= margin || major <= minor || minor <= margin) return;
  const start = origin.addScaledVector(axis, lo - margin).toArray() as XYZ;
  const dir = axis.toArray() as XYZ;
  const outer = makeCylinder(major + margin, hi - lo + 2 * margin, start, dir);
  let core: Shape3D | undefined;
  try {
    core = makeCylinder(minor - margin, hi - lo + 2 * margin, start, dir);
    return outer.cut(core);
  } finally { core?.delete(); outer.delete(); }
}

function interferenceVolume(overlap: Shape3D, socket: ThreadFrame | undefined, tenon: ThreadFrame | undefined, relative: Matrix4) {
  const volume = Math.abs(measureVolume(overlap));
  if (!Number.isFinite(volume) || volume <= margin || !socket || !tenon) return volume;
  const teeth = cosmeticTeeth(socket, tenon, relative);
  if (!teeth) return volume;
  let remainder: Shape3D | undefined;
  try {
    remainder = overlap.cut(teeth);
    return Math.abs(measureVolume(remainder));
  } finally { remainder?.delete(); teeth.delete(); }
}

export function verifyCapMount(bodies: Body[], ids: string[], capId: string, matrices: number[][], joint?: CapJoint) {
  const index = ids.indexOf(capId);
  if (index < 0 || bodies.length !== ids.length || matrices.length !== ids.length || !matrices.every(isRigidTransform))
    throw Error("Rebuild the assembly before checking the cap position.");
  const cap = bodies[index], inverse = new Matrix4().fromArray(matrices[index]).invert();
  const socket = findThread(cap.threadFrames ?? [], capId, joint?.threadMate?.moving);
  const capBox = cap.shape.boundingBox;
  try {
    for (let i = 0; i < bodies.length; i++) {
      if (i === index) continue;
      const other = bodies[i], relative = inverse.clone().multiply(new Matrix4().fromArray(matrices[i]));
      const placed = positioned(other.shape, relative.toArray());
      let overlap: Shape3D | undefined;
      try {
        const otherBox = placed.boundingBox;
        try { if (capBox.isOut(otherBox)) continue; } finally { otherBox.delete(); }
        overlap = cap.shape.intersect(placed);
        const tenon = joint?.parent === ids[i] ? findThread(other.threadFrames ?? [], ids[i], joint.threadMate?.mating) : undefined;
        const volume = interferenceVolume(overlap, socket, tenon, relative);
        if (!Number.isFinite(volume)) throw Error("Turnmill could not measure the cap against " + other.name + ".");
        if (volume > margin) throw Error("The cap hits " + other.name + ". Deepen or widen the cap cavity, or move the part clear.");
      } finally { overlap?.delete(); placed.delete(); }
    }
  } finally { capBox.delete(); }
}

// Both positions use the same freshly built solids and measured thread frames.
export function verifyCapPosting(project: Project, capId: string, bodies: Body[], ids: string[]) {
  const mount = project.workspaces?.capMounts?.[capId];
  if (!mount) throw Error("This cap needs a thread connection at each barrel end.");
  const values = resolveParameters(project.parameters);
  const frames = bodies.flatMap(body => body.threadFrames ?? []);
  const back = mount.front === "start" ? "end" : "start";
  for (const end of [mount.front, back] as const) {
    try {
      const { workspaces } = setCapMount(project, capId, end);
      const config = resolveThreadMates(workspaces!.joints, frames, values, ids);
      const matrices = buildPoses(ids, config, workspaces!.jointPose ?? {}, values);
      verifyCapMount(bodies, ids, capId, matrices, config[capId]);
    } catch (cause) {
      const location = end === mount.front ? "Front" : "Back";
      throw Error(location + " seat — " + (cause instanceof Error ? cause.message : "The cap clearance could not be measured."));
    }
  }
}
