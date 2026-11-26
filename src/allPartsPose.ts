import { Matrix4 } from "three";
import { isRigidTransform } from "./rigidTransform";
import type { Project } from "./types";

/** Capture the current Assembly pose, including any unsaved joint motion. */
export function applyAllPartsPose(project: Project, matricesByBody: Record<string, number[]>,
  drivers?: Record<string, number[]>): Project {
  const parts = project.features.filter(f => f.operation === "new" && !f.suppressed);
  if (!parts.length) throw Error("Add a part to the assembly before applying its position.");
  const entries = parts.map(part => {
    const matrix = matricesByBody[part.id];
    if (!isRigidTransform(matrix))
      throw Error(`Wait for ${part.name} to finish rebuilding before applying the assembly position.`);
    return [part.id, matrix.slice()];
  });
  const workspaces = { ...project.workspaces, allPartsPose: Object.fromEntries(entries) };
  if (drivers) {
    const jointPose = { ...project.workspaces?.jointPose };
    for (const part of parts) {
      const coords = drivers[part.id];
      if (coords === undefined) delete jointPose[part.id];
      else {
        if (!Array.isArray(coords) || !coords.every(Number.isFinite))
          throw Error(`Set a finite joint position for ${part.name} before applying the assembly position.`);
        jointPose[part.id] = coords.slice();
      }
    }
    return { ...project, workspaces: { ...workspaces, jointPose } };
  }
  return { ...project, workspaces };
}

/** Body IDs survive history reorders. Parts created after the capture keep their modeling position. */
export function allPartsMatrices(project: Project, ids: string[]): number[][] | undefined {
  const saved = project.workspaces?.allPartsPose;
  if (!saved || typeof saved !== "object" || !ids.some(id => isRigidTransform(saved[id]))) return;
  return ids.map(id => isRigidTransform(saved[id]) ? saved[id].slice() : new Matrix4().toArray());
}
