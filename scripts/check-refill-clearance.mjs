import assert from "node:assert/strict";
import { Matrix4 } from "three";
import { near, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { collectFitSurfaces } = await api.load("fitSurfaces");
  const { diametralFit, refillBoreChecks } = await api.load("refillClearance");
  const { evaluateFinish } = await api.load("finishingTypes");
  const { blankProject } = await api.load("projects");
  const { insertRefill } = await api.load("refills");
  const { evaluateModel } = await api.load("buildModel");
  const turn = (id, points) => ({ id, name: id, kind: "revolve", operation: "new", amount: 360, points });
  const ring = (id, start, end, bore) => turn(id, [[start,bore/2],[start,5],[end,5],[end,bore/2]]);
  const drill = evaluateFinish({ id:"drill", name:"Guide bore", kind:"hole", end:"start", profile:"straight",
    diameter:"shaft_od - 1 mm", termination:"through", offsetU:"0 mm", offsetV:"0 mm" }, { shaft_od: 6 });
  const p = insertRefill(blankProject(), "energel-lr7", { body_diameter: "6 mm" }, { bodyId: "refill" }).project;
  const {features: refill} = await evaluateModel(p);
  const features = [
    ...refill, ring("tight",30,35,5), ring("exact",35,40,6), ring("loose",40,50,7),
    ring("guide",4,7,2.4), ring("outside",115,120,1), ring("skew",30,35,4),
    { ...turn("drilled",[[42,0],[42,5],[48,5],[48,0]]), finishes:[drill] },
  ];
  const bodies = buildBodies(features);
  try {
    const ids = features.map(f => f.id);
    const lands = bodies.map((b, i) => collectFitSurfaces(b.shape, ids[i]));
    const assemblyPose = new Matrix4().makeRotationZ(Math.PI / 3).setPosition(15, -12, 9);
    const poses = ids.map(id => (id === "skew" ? assemblyPose.clone().multiply(new Matrix4().makeTranslation(0, 1, 0)) : assemblyPose).toArray());
    const checks = refillBoreChecks("refill", ids, lands, poses);
    assert.deepEqual(checks.map(c => c.bodyId).sort(), ["drilled","exact","guide","loose","tight"]);
    const check = id => checks.find(c => c.bodyId === id);
    assert.equal(check("exact").status, "line-to-line");
    for (const id of ["drilled", "tight"]) {
      assert.equal(check(id).status, "interference");
      near(check(id).refillDiameter,6,1e-6,"tube");
      near(check(id).clearance,-1,1e-6,"negative diametral clearance");
    }
    near(check("guide").refillDiameter,2.27,1e-6,"only the guide overlaps here");
    near(check("guide").clearance,0.13,1e-6,"tip guide clearance");
    near(check("loose").clearance,1,1e-6,"positive clearance");
    // The transverse shoulder ends exactly where the adjacent tube band begins.
    const atEnd = [...poses];
    atEnd[ids.indexOf("tight")] = assemblyPose.clone().multiply(new Matrix4().makeTranslation(81,0,0)).toArray();
    assert(!refillBoreChecks("refill", ids, lands, atEnd).some(c => c.bodyId === "tight"));
    const empty = lands.map((v,i) => i ? v : []);
    assert.deepEqual(refillBoreChecks("refill", ids, empty, poses), []);
    assert.deepEqual(refillBoreChecks("missing", ids, lands, poses), []);
    assert.throws(() => diametralFit(0,6));
  } finally { releaseBodies(bodies); }
  const tapered = buildBodies([
    turn("cartridge", [[0,0],[0,1.5],[8,1.5],[12,3],[20,3],[20,0]]),
    ring("part",7,11,4.5),
  ]);
  try {
    const ids = ["cartridge", "part"];
    const measured = tapered.map((b, i) => collectFitSurfaces(b.shape, ids[i], true));
    assert.equal(measured[0].filter(s => s.endDiameter !== undefined).length, 1);
    const mate = new Matrix4().toArray();
    const [result] = refillBoreChecks("cartridge", ids, measured, [mate, mate]);
    near(result.refillDiameter,5.25,1e-6,"overlapping part of the conical shoulder");
    near(result.clearance,-0.75,1e-6,"taper interferes even though the straight neck fits");
    const reversed = new Matrix4().makeRotationZ(Math.PI).setPosition(20,0,0);
    // The original bore [7,11] occupies refill coordinates [9,13] after reversal.
    const [flip] = refillBoreChecks("cartridge", ids, measured, [reversed.toArray(),mate]);
    near(flip.clearance,-1.5,1e-6,"opposed shaft axis");
    assert(collectFitSurfaces(tapered[0].shape, ids[0]).every(s => s.endDiameter === undefined));
  } finally { releaseBodies(tapered); }
  console.log("PASS nominal refill diametral fit from revolved and drilled bores, stepped refill, assembly poses, and separated lands.");
} finally { await api.close(); }
