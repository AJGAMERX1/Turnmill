import assert from "node:assert/strict";
import { Matrix4 } from "three";
import { boxSketch, feature, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { analyzeWritingFit, applyWritingPose } = await api.load("writingFit");
  const { measureWritingBodyGeometry } = await api.load("writingFitGeometry");
  const { collectFitSurfaces } = await api.load("fitSurfaces");
  const { buildPoses } = await api.load("kinematics");
  const { resolveThreadMates } = await api.load("threadMates");
  const { createThreadedCone } = await api.load("threadedCone");
  const { insertRefill } = await api.load("refills");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  for (const end of ["start", "end"]) {
    const raw = project([boxSketch("blank", 0, 4, 102, 8)], [feature("barrel", "blank", 360, "revolve")]);
    const rim = { axis: "X", centerline: [0, 0, 0], station: end === "start" ? 0 : 102, outside: 16, bore: 8 };
    const { project: threaded, coneId } = createThreadedCone(raw, "barrel", rim, {
      end, size: "M10 × 1", length: "4 mm", coneLength: "15 mm", tipDiameter: "4 mm",
      opening: "2.35 mm", allowance: "0.1 mm", mode: "cosmetic", ...(end === "start" ? { backWall: "8 mm" } : {}),
    });
    const { project: doc, bodyId: refillId } = insertRefill(threaded, "energel-lr7", {}, { reversed: end === "end" });
    const model = await evaluateModel(doc);
    const bodies = buildBodies(model.features);
    try {
      const bodyIds = model.features.filter(f => f.operation === "new").map(f => f.id);
      const frames = bodies.flatMap(b => b.threadFrames);
      const joints = resolveThreadMates(doc.workspaces.joints, frames, model.values, bodyIds);
      const pose = buildPoses(bodyIds, joints, {}, model.values);
      // A common arbitrary world placement must not affect measured or proposed local dimensions.
      const world = new Matrix4().makeRotationY(.73).setPosition(12, 55, -9);
      const matrices = pose.map(p => world.clone().multiply(new Matrix4().fromArray(p)).toArray());
      const surfaces = bodies.map((b, i) => collectFitSurfaces(b.shape, bodyIds[i], true));
      const bodyGeometry = bodies.map(b => measureWritingBodyGeometry(b.shape));
      const input = { coneId, refillId, exposure: 2, bodyIds, matrices, surfaces, bodyGeometry };
      const result = analyzeWritingFit(doc, input);
      assert.equal(result.rearStatus, end === "start" ? "contact" : "open");
      near(result.tailDiameter, 6.35, 1e-6, "flat EnerGel tail");
      near(result.tailPoint[0], end === "start" ? 94 : 8, 1e-6, "tail at selected projection");
      near(result.coneClearance.clearance, -.65, 1e-6, "3 mm neck interferes behind a 2.35 mm opening");
      near(result.barrelClearance.clearance, 1.65, 1e-6, "tube clearance");
      assert.equal(result.requestedExposure, 2);
      assert.throws(() => analyzeWritingFit(doc, { ...input, exposure: 8 }), /shoulder/);
      const unseated = buildPoses(bodyIds, joints, { [coneId]: [end === "start" ? -180 : 180] }, model.values);
      assert.throws(() => analyzeWritingFit(doc, { ...input, matrices: unseated }), /Fully seat/);
      const mounted = applyWritingPose(doc, result);
      const after = resolveThreadMates(mounted.workspaces.joints, frames, model.values, bodyIds);
      const moved = buildPoses(bodyIds, after, mounted.workspaces.jointPose, model.values);
      const measured = analyzeWritingFit(mounted, { ...input, matrices: moved });
      assert.equal(measured.currentAlignment, "aligned");
      near(measured.currentExposure, 2, 1e-6, "tip projection after mounting");
      const shifted = moved.map((m, i) => i === bodyIds.indexOf(refillId)
        ? new Matrix4().makeTranslation(0, .2, 0).multiply(new Matrix4().fromArray(m)).toArray() : m);
      assert.equal(analyzeWritingFit(mounted, { ...input, matrices: shifted }).currentAlignment, "off-axis");
      if (end === "start") {
        const tooShort = analyzeWritingFit(doc, { ...input, exposure: 1 });
        assert.equal(tooShort.rearStatus, "interference");
        near(tooShort.rearGap, -1, 1e-6, "tail through back wall");
        const gap = analyzeWritingFit(doc, { ...input, exposure: 3 });
        assert.equal(gap.rearStatus, "gap");
        near(gap.rearGap, 1, 1e-6, "one millimetre between tail and backing");
      }
    } finally { releaseBodies(bodies); }
  }
  console.log("PASS actual cone and tenon passage, front/reversed EnerGel, closed/open back, interference, rear gap, assembly transforms and writing-tip projection.");
} finally { await api.close(); }
