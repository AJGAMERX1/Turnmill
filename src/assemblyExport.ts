import { exportBodies, releaseBodies, type Body } from "./geometry";
import { positioned } from "./motionGeometry";
import { buildPoses, type JointConfig } from "./kinematics";
import { resolveThreadMates } from "./threadMates";
import { resolveParameters } from "./expressions";
import type { Parameter } from "./types";

export type AssemblyExport = {
  ids: string[];
  joints: JointConfig;
  drivers: Record<string, number[]>;
  parameters: Parameter[];
};

export function exportAssemblyBodies(
  bodies: Body[],
  format: "step" | "stl" | "3mf",
  pose: AssemblyExport,
) {
  if (bodies.length !== pose.ids.length)
    throw Error("The assembly changed. Rebuild it before exporting.");
  const values = resolveParameters(pose.parameters);
  const frames = bodies.flatMap((body) => body.threadFrames ?? []);
  const joints = resolveThreadMates(pose.joints, frames, values, pose.ids);
  const matrices = buildPoses(pose.ids, joints, pose.drivers, values);
  const installed: Body[] = [];
  try {
    for (const [i, body] of bodies.entries())
      installed.push({ name: body.name, shape: positioned(body.shape, matrices[i]) });
    return exportBodies(installed, format);
  } finally {
    releaseBodies(installed);
  }
}
