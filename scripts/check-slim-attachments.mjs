import assert from "node:assert/strict";
import { makeCylinder } from "replicad";
import { near, runtime } from "../tests/systems/runtime.mjs";
import { barrelId, cappedPen, refillId } from "../tests/qa/fixtures/capped-pen.mjs";

const api = await runtime();
try {
  const { narrowBarrel } = await api.load("slimBarrel");
  const { planSlimAttachments } = await api.load("slimAttachments");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { prepareWritingFit } = await api.load("prepareWritingFit");
  const { checkWritingGeometry } = await api.load("writingFitWorker");
  const { verifyCapPosting } = await api.load("capClearanceGeometry");
  const { verifySlimFlush } = await api.load("slimFlushGeometry");
  const { setCapMount } = await api.load("threadedCone");
  const { resolveThreadMates } = await api.load("threadMates");
  const { buildPoses } = await api.load("kinematics");
  const { resolveParameters } = await api.load("expressions");
  const fixture = await cappedPen(api), { coneId, capId } = fixture;
  // Start with a fit proven against the synthetic installed cartridge and both cap mounts.
  const setup = { coneId, barrelId, refillId, projection: "1.5 mm", clearance: "0.1 mm", endplay: "0 mm" };
  const original = await evaluateModel(fixture.document);
  const live = buildBodies(original.features);
  let fitted;
  try {
    fitted = (await prepareWritingFit(fixture.document, setup, job => Promise.resolve(checkWritingGeometry(job, live, original.features)))).project;
  } finally { releaseBodies(live); }
  const opts = { barrelId, coneId, boreDiameter: 6.55, requestedDiameter: 7.35, minimumWall: .35 };
  const plan = planSlimAttachments(fitted, opts);
  assert.equal(plan.capThreads.length, 1);
  near(plan.appliedDiameter, 10.7, 1e-6, "flush capped minimum uniform OD");
  assert.equal(plan.coneThread, "M8 × 1"); assert.equal(plan.capThreads[0], "M10 × 1");
  assert.equal(plan.appliedDiameter, plan.minimumDiameter);
  const doc = structuredClone(narrowBarrel(plan.project, barrelId, plan.appliedDiameter, opts.boreDiameter,
    resolveParameters(plan.project.parameters), opts.minimumWall));
  for (const f of doc.features) for (const t of f.finishes ?? []) if (t.kind === "thread") t.mode = "modeled";
  const result = await evaluateModel(doc), bodies = buildBodies(result.features);
  try {
    const proof = checkWritingGeometry({ project: doc, action: "verify", setup: doc.workspaces.writingSetups[coneId] }, bodies, result.features);
    near(proof.fit.currentExposure, 1.5, 1e-5, "narrowed writing projection");
    near(proof.fit.rearGap, 0, 1e-5, "real rear stop");
    assert.equal(proof.caps, 1);
    const ids = result.features.filter(f => f.operation === "new").map(f => f.id);
    verifyCapPosting(doc, capId, bodies, ids);
    const frames = bodies.flatMap(b => b.threadFrames ?? []);
    for (const end of ["start", "end"]) {
      const mounted = setCapMount(doc, capId, end), joint = mounted.workspaces.joints[capId];
      const poses = buildPoses(ids, resolveThreadMates(mounted.workspaces.joints, frames, result.values, ids),
        mounted.workspaces.jointPose, result.values);
      const barrel = bodies[ids.indexOf(barrelId)], cap = bodies[ids.indexOf(capId)];
      verifySlimFlush(barrel, cap, joint, poses[ids.indexOf(barrelId)], poses[ids.indexOf(capId)]);
      // Turn just the back shoulder 0.3 mm smaller, leaving the original maximum body OD.
      if (end === "start") {
        const post = frames.find(f => f.finishId === joint.threadMate.mating.finishId);
        const start = [post.entrance[0] + post.length - .15, 0, 0];
        const stock = makeCylinder(plan.appliedDiameter, 1.5, start, [1, 0, 0]);
        const leave = makeCylinder((plan.appliedDiameter - .3) / 2, 1.5, start, [1, 0, 0]);
        const ring = stock.cut(leave), reduced = barrel.shape.cut(ring);
        try {
          assert.throws(() => verifySlimFlush({ ...barrel, shape: reduced }, cap, joint,
            poses[ids.indexOf(barrelId)], poses[ids.indexOf(capId)]), /its shoulder is Ø10.4 mm/);
        } finally { reduced.delete(); ring.delete(); leave.delete(); stock.delete(); }
      }
      const off = [...poses[ids.indexOf(capId)]];
      off[12] += 0.15;
      assert.throws(() => verifySlimFlush(barrel, cap, joint, poses[ids.indexOf(barrelId)], off), /does not meet/);
    }
    assert.equal(result.values.cone_pitch, 1); assert.equal(result.values.cap_diameter, plan.appliedDiameter);
    near(result.values.cone_opening, 2.37, 1e-5, "writing guide");
  } finally { releaseBodies(bodies); }
  const thicker = planSlimAttachments(fitted, { ...opts, minimumWall: 1, requestedDiameter: 13 });
  const v = resolveParameters(thicker.project.parameters);
  assert(v.cap_diameter - v.cap_major >= 2 - 1e-5);
  assert(v.cone_tip >= v.cone_opening + 2 - 1e-5);
  assert(v.cap_wall >= 1);
  const thinRoof = structuredClone(fitted);
  thinRoof.parameters.find(p => p.name === "cap_wall").expression = "0.6 mm";
  const roof = resolveParameters(planSlimAttachments(thinRoof, { ...opts, minimumWall: 1 }).project.parameters);
  near(roof.cap_wall, 1, 1e-8, "minimum roof");
  near(roof.cap_length - roof.cap_wall, 29.4, 1e-8, "usable cap depth after increasing roof");
  const modified = structuredClone(fitted);
  const capSketch = modified.sketches.find(s => s.capProfile);
  capSketch.points[1].y = "9.99 mm";
  assert.throws(() => planSlimAttachments(modified, opts), /custom wall/);
  const aliased = structuredClone(fitted);
  aliased.parameters.find(p => p.name === "cone_tip").expression = "cone_major / 3.2";
  assert.throws(() => planSlimAttachments(aliased, opts), /cone_tip changes/);
  const custom = structuredClone(fitted);
  custom.parameters.find(p => p.name === "cone_major").expression = "15.9 mm";
  const customFit = planSlimAttachments(custom, { ...opts, requestedDiameter: 20 });
  assert.equal(customFit.coneThread, "Custom Ø15.9 mm × 1 mm pitch");
  const noCap = structuredClone(fitted);
  const { ends } = noCap.workspaces.capMounts[capId];
  const maleIds = new Set(Object.values(ends).map(m => m.threadMate.mating.finishId));
  delete noCap.workspaces.capMounts[capId]; delete noCap.workspaces.joints[capId];
  noCap.features = noCap.features.filter(f => f.id !== capId).map(f => ({ ...f, finishes: f.finishes?.filter(t => !maleIds.has(t.id)) }));
  const uncapped = planSlimAttachments(noCap, opts);
  assert.deepEqual(uncapped.capThreads, []);
  near(uncapped.minimumDiameter, 8.7, 1e-6, "single threaded joint lower bound");
  const changed = structuredClone(fitted);
  changed.features.find(f => f.id === coneId).finishes[0].pitch = "1 mm";
  assert.throws(() => planSlimAttachments(changed, opts), /original linked threads/);
  const { insertRefill } = await api.load("refills");
  const parker = insertRefill(fixture.document, "parker-g2", {}, { replaceBodyId: refillId }).project;
  const beforeParker = await evaluateModel(parker), parkerLive = buildBodies(beforeParker.features);
  try {
    const fit = await prepareWritingFit(parker, setup, job => Promise.resolve(checkWritingGeometry(job, parkerLive, beforeParker.features)));
    const p = planSlimAttachments(fit.project, { ...opts, boreDiameter: 6.2, minimumWall: 1 });
    const project = narrowBarrel(p.project, barrelId, p.appliedDiameter, 6.2, resolveParameters(p.project.parameters), 1);
    const built = await evaluateModel(project);
    const seat = built.features.find(f => project.features.find(p => p.id === f.id)?.writingSeat);
    assert.equal(seat.operation, "add");
    near(seat.points[1][1] - seat.points[0][1], 1, 1e-6, "enlarged Parker pilot radial wall");
    const proof = checkWritingGeometry({ project, setup, features: built.features, action: "verify", slim: true }, parkerLive, beforeParker.features);
    near(proof.fit.rearGap, 0, 1e-5, "Parker remains retained"); assert.equal(proof.caps, 1);
  } finally { releaseBodies(parkerLive); }
  console.log("PASS measured thread lower bounds, real nominal/M8+M10 helical geometry, matching front and posted caps, written projection and rear backing, uncapped and custom-joint cases");
} finally { await api.close(); }
