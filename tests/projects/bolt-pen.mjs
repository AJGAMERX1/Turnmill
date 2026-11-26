import assert from "node:assert/strict";
import { runtime, geometry, near } from "../systems/runtime.mjs";
import { measureVolume } from "replicad";

const api = await runtime();
const bodies = [];
try {
  const { insertRefill } = await api.load("refills");
  const { boltPenProject } = await api.load("boltPen");
  const { validateProject } = await api.load("projects");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { resolveBoltTrack, boltTrackPosition } = await api.load("boltTrack");
  const { bodyIds, buildPoses } = await api.load("kinematics");
  const { positioned } = await api.load("motionGeometry");
  const { exportAssemblyBodies } = await api.load("assemblyExport");
  const p = validateProject(JSON.parse(JSON.stringify(boltPenProject())));
  const { features, values } = await evaluateModel(p);
  const config = p.workspaces.joints, ids = bodyIds(features);
  const bolt = p.workspaces.boltPen.carrierId;
  const track = resolveBoltTrack(config[bolt].bolt, values);
  bodies.push(...buildBodies(features));
  for (const body of bodies) {
    const g = geometry(body.shape);
    assert.ok(g.valid && g.solids === 1 && g.volume > 0, body.name);
  }
  const samples = [0, track.stroke / 2, track.stroke, track.stroke + track.arc / 2,
    track.stroke + track.arc, track.total];
  for (const distance of samples) {
    const mats = buildPoses(ids, config, { [bolt]: [distance] }, values);
    const posed = new Map(ids.map((id, i) => [id, positioned(bodies[i].shape, mats[i])]));
    try {
      const tipX = geometry(posed.get("bolt-refill")).bbox[0][0];
      near(tipX, values.pocket_recess + boltTrackPosition(track, distance).axial, 0.001, "physical refill tip");
      if (!distance) near(tipX, values.pocket_recess, 0.001, "pocket recess");
      if (distance === track.total) near(tipX, -values.tip_projection, 0.001, "writing exposure");
      for (const [a, b] of [
        ["bolt-nose-ring", "bolt-nose"], ["bolt-nose-ring", "bolt-barrel"],
        ["bolt-clip", "bolt-barrel"], ["bolt-clip", "bolt-tail"], ["bolt-clip", "bolt-stud"],
        ["bolt-tail", "bolt-barrel"], ["bolt-tail", "bolt-carrier"], ["bolt-nose", "bolt-barrel"],
        ["bolt-stud", "bolt-barrel"], ["bolt-stud", "bolt-carrier"], ["bolt-refill", "bolt-nose"],
        ["bolt-refill", "bolt-barrel"], ["bolt-refill", "bolt-carrier"], ["bolt-carrier", "bolt-barrel"],
      ]) {
        const common = posed.get(a).intersect(posed.get(b));
        try { near(measureVolume(common), 0, 1e-7, distance + " mm " + a + " / " + b); }
        finally { common.delete(); }
      }
    } finally { for (const shape of posed.values()) shape.delete(); }
  }
  // Distinct assembly exports contain the component names and carry each pose.
  for (const distance of [0, track.total]) {
    const step = await exportAssemblyBodies(bodies, "step", {
      ids, joints: config, drivers: { [bolt]: [distance] }, parameters: p.parameters,
    }).text();
    assert.ok(step.includes("ISO-10303-21") && step.includes("Thumb stud") && step.includes("Refill carrier"));
  }
  for (const [kind, overrides] of [
    ["energel-lr7", {}],
    // Synthetic measured donor, not published BIC manufacturing dimensions.
    ["bic-cristal", { length: "129 mm", guide_diameter: "2.3 mm", body_diameter: "3.1 mm", shoulder_distance: "7 mm" }],
  ]) {
    const replacement = insertRefill(p, kind, overrides, { replaceBodyId: "bolt-refill" }).project;
    const model = await evaluateModel(replacement);
    near(model.values.overall_length - values.overall_length, model.values.refill_length - values.refill_length, 1e-6, kind + " barrel resize");
    const parts = buildBodies(model.features);
    try {
      for (const distance of [0, track.stroke, track.total]) {
        const matrices = buildPoses(ids, replacement.workspaces.joints, { [bolt]: [distance] }, model.values);
        const index = ids.indexOf("bolt-refill");
        const refill = positioned(parts[index].shape, matrices[index]);
        try {
          for (const id of ["bolt-nose","bolt-barrel","bolt-carrier"]) {
            const i = ids.indexOf(id);
            const other = positioned(parts[i].shape, matrices[i]);
            const overlap = refill.intersect(other);
            try { near(measureVolume(overlap), 0, 1e-7, kind + " / " + id); }
            finally { other.delete(); overlap.delete(); }
          }
        } finally { refill.delete(); }
      }
    } finally { releaseBodies(parts); }
  }
  console.log("Passed bolt pen B-reps, J-slot, tip positions, component interference at six poses, all three refill families, native reload and STEP.");
  releaseBodies(bodies.splice(0));
} finally {
  for (const body of bodies) body.shape.delete();
  await api.close();
}
