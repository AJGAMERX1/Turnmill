import { Matrix4 } from "three";
import { evaluate, resolveParameters } from "./expressions";
import { defaultJoint, isFloating, jointMount, placementFromMatrix, type JointConfig } from "./kinematics";
import { bindHistoryTargets, bodyOwners } from "./partTabs";
import { uid } from "./projects";
import { refillComponents } from "./refills";
import { isRigidTransform } from "./rigidTransform";
import type { Feature, Project } from "./types";

/** Remove the absorbed node from the assembly tree while keeping its other children in place. */
function mergedJoints(project: Project, keep: Feature, tool: Feature, toolInKeep: Matrix4) {
  const original: JointConfig = project.workspaces?.joints ?? {};
  const joints = { ...original };
  const directParent = original[keep.id]?.parent === tool.id;
  const visited = new Set<string>();
  for (let ancestor = original[keep.id]?.parent; ancestor; ancestor = original[ancestor]?.parent) {
    if (visited.has(ancestor)) throw Error("The assembly has a joint loop. Repair it before merging.");
    visited.add(ancestor);
    if (ancestor === tool.id && !directParent)
      throw Error(`Keep ${tool.name} and merge ${keep.name} into it, or detach the joint between them first.`);
  }
  if (directParent) {
    const upstream = original[tool.id];
    if (upstream && upstream.kind !== "fixed")
      throw Error(`Keep ${tool.name} to retain its moving joint, or detach it before merging.`);
    // The joint between the merging parts goes away. Make the kept frame
    // follow the same outside parent at the position captured for this merge.
    const values = resolveParameters(project.parameters);
    const local = upstream ? jointMount(upstream, values) : new Matrix4();
    if (upstream) {
      const [x, y, z] = upstream.offset.map(expression => evaluate(expression, values));
      local.multiply(new Matrix4().makeTranslation(x, y, z));
    }
    local.multiply(toolInKeep.clone().invert());
    joints[keep.id] = {
      ...defaultJoint(), parent: upstream?.parent ?? "", floating: isFloating(upstream),
      placement: placementFromMatrix(local),
    };
  }
  for (const [id, child] of Object.entries(original)) {
    if (id === tool.id || (directParent && id === keep.id)) continue;
    if (child.cam?.driver === tool.id || (directParent && child.cam?.driver === keep.id))
      throw Error("Unlink the cam follower driven by the merging part in Assembly before merging.");
    if (child.parent !== tool.id) continue;
    if (child.threadMate)
      throw Error("Detach the thread connection to the absorbed part in Assembly before merging.");
    const frame = toolInKeep.clone();
    if (child.parentFrame) frame.multiply(new Matrix4().fromArray(child.parentFrame));
    joints[id] = { ...child, parent: keep.id, parentFrame: frame.toArray() };
  }
  delete joints[tool.id];
  return joints;
}

/** Build an immutable candidate. The caller commits only after the B-rep kernel verifies the union. */
export function mergeParts(
  project: Project,
  targetId: string,
  toolId: string,
  transform: number[],
  assemblyTransform: number[] = transform,
): Project {
  if (targetId === toolId) throw Error("Choose two different parts to merge.");
  if (!isRigidTransform(transform) || !isRigidTransform(assemblyTransform))
    throw Error("The part placement is invalid. Reposition the parts in Assembly and try again.");
  const bound = bindHistoryTargets(project.features);
  const owners = bodyOwners(bound);
  const keep = bound.find(f => f.id === targetId && f.operation === "new" && !f.suppressed);
  const tool = bound.find(f => f.id === toolId && f.operation === "new" && !f.suppressed);
  if (!keep || !tool) throw Error("Choose two active solid parts. Restore any suppressed body first.");

  const toolHistory = bound.filter(f => owners.get(f.id) === toolId);
  const refills = refillComponents(project);
  const targetRefill = refills.find(r => r.bodyId === targetId);
  const toolRefill = refills.find(r => r.bodyId === toolId);
  const merged: Feature = {
    id: uid(), name: "Merge " + tool.name, kind: "merge", operation: "add",
    bodyId: keep.id, amount: "0", sketchId: "", suppressed: false,
    merge: { features: toolHistory, transform: [...transform], targetRefill, toolRefill },
  };
  const features = bound.filter(f => owners.get(f.id) !== toolId);
  const start = features.indexOf(keep);
  const nextBody = features.findIndex((f, i) => i > start && f.operation === "new");
  features.splice(nextBody < 0 ? features.length : nextBody, 0, merged);

  const ws = { ...project.workspaces };
  if (ws.joints) ws.joints = mergedJoints(project, keep, tool, new Matrix4().fromArray(assemblyTransform));
  // The combined stock uses the kept part's material, mass calculation, and part number.
  // A composite body no longer represents one purchased refill or catalog item.
  for (const key of ["bodyMaterials", "bodyDensities", "jointPose", "refills", "refillDiameterChecks", "hardwareComponents"]) {
    if (!ws[key]) continue;
    const records = { ...ws[key] };
    delete records[toolId];
    if (["refills", "refillDiameterChecks", "hardwareComponents"].includes(key) ||
        (key === "jointPose" && project.workspaces?.joints?.[targetId]?.parent === toolId)) {
      delete records[targetId];
    }
    ws[key] = records;
  }
  if (ws.drawing?.feature === toolId) ws.drawing = { ...ws.drawing, feature: targetId };
  // Body-specific sheet settings and reserved BOM numbers stay under their original IDs.
  // A fit referring to an absorbed surface cannot identify that face in the combined solid.
  if (Array.isArray(ws.matingFits) && ws.matingFits.some(f => f?.boreBody === toolId || f?.shaftBody === toolId))
    throw Error("Remove the saved mating fit on the absorbed part in Assembly before merging.");
  if (ws.boltPen && (Object.values(ws.boltPen).includes(toolId) || ws.boltPen.refillId === targetId))
    delete ws.boltPen;
  if (ws.penGuide && [ws.penGuide.barrelId, "pen-cap", "pen-clip", "pen-refill"].includes(toolId))
    delete ws.penGuide;
  return {
    ...project, features, workspaces: ws,
    sketches: project.sketches.map(sketch => sketch.partId === toolId ? { ...sketch, partId: targetId } : sketch),
  };
}
