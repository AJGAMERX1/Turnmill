import assert from "node:assert/strict";
import { makeCylinder, measureVolume } from "replicad";
import { feature, geometry, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { planRefillBacking, addRefillBacking, withoutRefillBacking } = await api.load("refillBacking");
  const { verifyRefillBackingStock } = await api.load("refillBackingGeometry");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { collectFitSurfaces } = await api.load("fitSurfaces");
  const { measureWritingBodyGeometry } = await api.load("writingFitGeometry");
  const { validateProject } = await api.load("projects");
  const { barrelEnd, createThreadedCap, createThreadedCone, compatiblePairSizes, suggestCapFit, applyCapConeFit } = await api.load("threadedCone");
  const { checkWritingGeometry } = await api.load("writingFitWorker");
  const { shapeWritingSeat, withoutWritingSeat } = await api.load("writingConeSeat");
  const { applyWritingPose } = await api.load("writingFit");
  const { insertRefill } = await api.load("refills");
  const { verifyCapPosting } = await api.load("capClearanceGeometry");
  const build = async p => buildBodies((await evaluateModel(p)).features);
  const profile = (id, points) => ({ id, name: id, constraints: [],
    points: points.map(([x,y]) => ({ x: String(x), y: String(y) })) });
  const turning = feature("barrel", "profile", 360, "revolve");
  const sleeve = project([profile("profile", [[0,4],[0,6],[120,6],[120,4]])], [turning]);
  const open = (tail, sign) => ({
    barrelId: "barrel", barrelAxis: "X", tailPoint: [tail,0,0], inward: [sign,0,0],
    rearEndDistance: sign === 1 ? 120 - tail : tail, tailDiameter: 6, rearStatus: "open",
  });
  function commonVolume(a, b) {
    const common = a.intersect(b);
    try { return Math.abs(measureVolume(common)); } finally { common.delete(); }
  }

  let capped;
  const blanks = await build(sleeve);
  try {
    const lands = collectFitSurfaces(blanks[0].shape, "barrel");
    capped = createThreadedCap(sleeve, "barrel", barrelEnd(lands, "X", "end"), {
      end:"end", size:"M10 × 0.75", length:"2.25 mm", allowance:"0.1 mm", mode:"cosmetic",
      capLength:"15 mm", capDiameter:"12 mm", crown:"flat", crownLength:"2 mm", wall:"1 mm",
    }, barrelEnd(lands, "X", "start")).project;
  } finally { releaseBodies(blanks); }

  const stock = await build(capped);
  try {
    const { shape, threadFrames } = stock[0];
    const lands = collectFitSurfaces(shape, "barrel"), before = JSON.stringify(capped);
    for (const [tail, sign, gap] of [[118,1,0], [1.3,-1,.3]]) {
      const fit = open(tail, sign), plan = planRefillBacking(capped, fit, lands, gap, threadFrames);
      assert.equal(plan.kind, "shoulder");
      verifyRefillBackingStock(shape, plan);
      const next = addRefillBacking(capped, plan);
      assert.equal(addRefillBacking(next,{ kind:"existing",barrelId:"barrel",gap }),next,"accepting an existing physical stop is idempotent");
      const stop = next.features.find(f => f.refillBacking);
      assert.equal(stop.bodyId, "barrel");
      assert(next.features.indexOf(stop) < next.features.findIndex(f => f.operation === "new" && f.id !== "barrel"));
      const restored = validateProject(JSON.parse(JSON.stringify(next)));
      const result = await build(restored);
      try {
        const backing = result[0].shape, measured = geometry(backing), original = geometry(shape);
        assert.equal(measured.valid, true);
        assert.equal(measured.solids, 1);
        assert.deepEqual(measured.bbox, original.bbox);
        assert.deepEqual(result[0].threadFrames, threadFrames);
        const delta = Math.PI * (4**2 - 1.5**2) * Math.abs(plan.backStation - plan.faceStation);
        near(measured.volume - original.volume, delta, 1e-5, "only the annular bore volume was added");
        const seat = measureWritingBodyGeometry(backing).seats.find(s => s.direction === -sign &&
          Math.abs(s.center[0] - (tail + sign*gap)) < 1e-7 && Math.abs(s.inner - 3) < 1e-7);
        assert(seat, "finished annular bearing at exactly the requested endplay");
        const refill = makeCylinder(3, 90, [tail - 90*sign,0,0], [sign,0,0]);
        const pressed = refill.clone().translate([sign*(gap + .15),0,0]);
        const vent = makeCylinder(1.49, 120, [0,0,0], [1,0,0]);
        try {
          near(commonVolume(backing, refill), 0, 1e-7, "no interference at target pose");
          assert(commonVolume(backing, pressed) > .1, "moving past the declared endplay is physically blocked");
          near(commonVolume(backing, vent), 0, 1e-7, "axial vent stays open");
        } finally { refill.delete(); pressed.delete(); vent.delete(); }
      } finally { releaseBodies(result); }
      const replan = planRefillBacking(capped, open(90,1), lands, 0, threadFrames);
      const replaced = addRefillBacking(next, replan);
      assert.deepEqual(replaced.features.filter(f => f.refillBacking).map(f => f.id), [stop.id]);
      assert.equal(replaced.sketches.length, next.sketches.length);
      assert.deepEqual(withoutRefillBacking(replaced,"barrel"), capped);
      const other = { ...feature("copy", stop.sketchId, 360, "revolve"), name: "Copy" };
      const shared = { ...next, features: [...next.features, other] };
      assert(withoutRefillBacking(shared, "barrel").sketches.some(s => s.id === stop.sketchId));
      assert.equal(JSON.stringify(capped), before, "original history can be restored verbatim on Undo");
    }
    const threaded = [{ bodyId:"barrel", side:"internal", axis:"X", entrance:[120,0,0], end:"end", length:4 }];
    assert.throws(() => planRefillBacking(capped, open(118,1), lands, 0, threaded), /internal thread/);
    const beforeThread = planRefillBacking(capped, open(115,1), lands, 0, threaded);
    near(beforeThread.backStation, 116, 1e-7, "backs up to cosmetic thread before the engagement begins");
    assert.throws(() => planRefillBacking(capped, open(121,1), lands, 0), /no barrel/);
    assert.throws(() => planRefillBacking(capped, open(60,1), [], 0), /complete cylindrical bore/);
    assert.throws(() => planRefillBacking(capped, open(60,1), lands, -.1), /zero or more/);
  } finally { releaseBodies(stock); }

  const blind = project([profile("profile", [[0,4],[0,6],[120,6],[120,0],[115,0],[115,4]])], [turning]);
  const blindSolids = await build(blind);
  try {
    const lands = collectFitSurfaces(blindSolids[0].shape, "barrel");
    const fit = (tail, gap) => ({ ...open(tail,1), rearStatus: gap === 0 ? "contact" : "gap", rearGap: gap, rearStopInnerDiameter: 0 });
    for (const [tail,gap] of [[115,0], [114.8,.2]]) {
      const plan = planRefillBacking(blind, fit(tail,gap), lands, gap);
      assert.equal(plan.kind, "existing");
      assert.equal(addRefillBacking(blind, plan), blind);
    }
    const deep = planRefillBacking(blind, fit(90,25), lands, .2);
    verifyRefillBackingStock(blindSolids[0].shape, deep);
    near(deep.faceStation, 90.2, 1e-7, "front-accessible blind stop face");
    near(deep.backStation, 115, 1e-7, "solid backing reaches floor of blind bore");
    assert.equal(deep.ventDiameter, 0);
    const deepResult = await build(addRefillBacking(blind, deep));
    const fullBack = makeCylinder(4, 115-90.2, [90.2,0,0], [1,0,0]);
    try {
      near(commonVolume(fullBack, deepResult[0].shape), measureVolume(fullBack), 1e-6,
        "solid stock throughout, with no trapped rear cavity");
    } finally { fullBack.delete(); releaseBodies(deepResult); }
    const stepped = lands.map(s => s.side === "bore" ? { ...s, end: 100 } : s);
    assert.throws(() => planRefillBacking(blind, fit(90,25), stepped), /stepped or interrupted/);
    const againstFloor = planRefillBacking(blind, fit(114.8,.2), lands, 0);
    near(againstFloor.backStation,115,1e-7,"short stop terminates at existing blind wall");
    const supported = await build(addRefillBacking(blind, againstFloor));
    try { assert.equal(geometry(supported[0].shape).solids, 1); } finally { releaseBodies(supported); }
    assert.throws(() => planRefillBacking(blind, fit(114.8,.2), lands, .4), /closer/);
    assert.throws(() => planRefillBacking(blind, { ...open(116,1), rearStatus:"interference", rearGap:-1 }, lands), /crosses/);
  } finally { releaseBodies(blindSolids); }

  const rearPilot = project([profile("profile", [[0,4],[0,6],[120,6],[120,2.15],[115,2.15],[115,4]])], [turning]);
  const pilotBodies = await build(rearPilot);
  try {
    const shape = pilotBodies[0].shape, lands = collectFitSurfaces(shape, "barrel");
    const floor = measureWritingBodyGeometry(shape).seats.find(s => Math.abs(s.center[0]-115) < 1e-6);
    const plan = planRefillBacking(rearPilot, { ...open(90,1),rearStatus:"gap",rearGap:25,rearStopInnerDiameter:floor.inner },lands);
    near(plan.ventDiameter,4.3,1e-7,"extend existing smaller passage at its original diameter");
    verifyRefillBackingStock(shape, plan);
    const formed = await build(addRefillBacking(rearPilot,plan));
    const opening = makeCylinder(2.15,120,[0,0,0],[1,0,0]);
    try { near(commonVolume(formed[0].shape,opening),0,1e-7,"full original passage preserved through the new shoulder"); }
    finally { opening.delete(); releaseBodies(formed); }
  } finally { releaseBodies(pilotBodies); }

  // The rear opening still clears the Ø6 tail, but a Ø8 back boring tool cannot
  // reach past its Ø7 restriction. The opposite placement fails from the front.
  const restricted = project([profile("profile", [[0,4],[0,6],[120,6],[120,3.5],[116,3.5],[116,4]])], [turning]);
  const restrictedSolids = await build(restricted);
  try {
    const shape = restrictedSolids[0].shape;
    const lands = collectFitSurfaces(shape,"barrel");
    const plan = planRefillBacking(restricted, open(90,1),lands);
    assert.throws(() => verifyRefillBackingStock(shape,plan), /narrower rear passage/);
    const reversed = planRefillBacking(restricted, open(90,-1),lands);
    assert.throws(() => verifyRefillBackingStock(shape,reversed), /narrower passage in front/);
  } finally { releaseBodies(restrictedSolids); }

  // Imported Z turning with an independent offset through-hole alongside its bore.
  const dir = [0,0,1], shaft = makeCylinder(6,120,[17,-9,0],dir);
  const bore = makeCylinder(4,120,[17,-9,0],dir), passage = makeCylinder(.4,120,[22,-9,0],dir);
  const hollow = shaft.cut(bore), offset = hollow.cut(passage);
  try {
    const source = { ...turning, name:"Offset barrel", kind:"import", sketchId:"", sourceId:"src", sourceIndex:0 };
    const imported = project([], [source], { importedFiles: [{ id:"src",format:"step",name:"offset.step",data:"",bodies:[{
      name:"Offset barrel",brep:offset.serialize() }] }] });
    const fit = { ...open(100,1), barrelAxis:"Z", tailPoint:[17,-9,100], inward:dir };
    const plan = planRefillBacking(imported, fit, collectFitSurfaces(offset,"barrel"), .2);
    verifyRefillBackingStock(offset, plan);
    const placed = addRefillBacking(imported,plan);
    const built = await build(placed);
    try {
      assert.equal(geometry(built[0].shape).solids, 1);
      const seat = measureWritingBodyGeometry(built[0].shape).seats.find(s => s.axis === "Z" && s.direction === -1 &&
        Math.abs(s.center[2]-100.2) < 1e-6);
      assert(seat);
      near(seat.center[0],17,1e-7,"offset backing axis");
      near(seat.center[1],-9,1e-7,"offset backing axis");
      near(commonVolume(passage,built[0].shape),0,1e-7,"separate through passage remains intact");
    } finally { releaseBodies(built); }
  } finally { [offset,hollow,passage,bore,shaft].forEach(s => s.delete()); }
  // A user may fit the cartridge first and add its posting cap later. Exercise
  // the cap fitter, the actual mated geometry, and refitting after those threads exist.
  async function writingJob(doc, setup, action) {
    const { features } = await evaluateModel(doc);
    const bodies = buildBodies(features);
    try { return checkWritingGeometry({ project: doc, setup, action }, bodies, features); }
    finally { releaseBodies(bodies); }
  }
  for (const kind of ["energel-lr7", "parker-g2"]) {
    const blank = project([profile("profile", [[0,4],[0,8],[120,8],[120,4]])], [turning]);
    const front = { axis:"X",centerline:[0,0,0],station:0,outside:16,bore:8 };
    const { project: nose, coneId } = createThreadedCone(blank,"barrel",front,{
      end:"start", size:"M10 × 1", length:"4 mm",coneLength:"15 mm",tipDiameter:"4 mm",opening:"3 mm",
      allowance:".1 mm",mode:"cosmetic",
    });
    const { project: doc, bodyId: refillId } = insertRefill(nose,kind);
    const setup = { coneId, barrelId:"barrel",refillId,projection:"2 mm",clearance:".1 mm",endplay:"0 mm" };
    const { fit,backing } = await writingJob(doc,setup,"measure");
    const seated = shapeWritingSeat(doc,fit,setup);
    const fitted = applyWritingPose(addRefillBacking(seated.project,backing),fit);
    const extra = fitted.features.find(f=>f.writingSeat);
    assert.equal(extra.operation, kind === "parker-g2" ? "add" : "cut");
    const model = await build(fitted);
    let cap;
    try {
      const surfaces = collectFitSurfaces(model[0].shape,"barrel",true);
      const front = barrelEnd(surfaces,"X","start"), rear = barrelEnd(surfaces,"X","end");
      assert(!compatiblePairSizes(fitted,"barrel",front,"cap",rear).length, "full cone OD obstructs the cap");
      const proposal = suggestCapFit(fitted,"barrel",front,rear,3);
      assert(proposal?.cone, "fitted cone can still be narrowed clear of the cap without cutting its internal seat");
      const custom = { ...fitted, features:fitted.features.map(f=>f===extra?{...f,writingSeat:undefined}:f) };
      assert(!suggestCapFit(custom,"barrel",front,rear,3)?.cone, "never automatically reshape a custom cone");
      const sized = applyCapConeFit(fitted,proposal.cone);
      cap = createThreadedCap(sized,"barrel",front,{
        end:"start",size:proposal.size,length:proposal.length+" mm",allowance:".1 mm",mode:"cosmetic",
        capLength:"35 mm", capDiameter:"16 mm", crown:"flat",crownLength:"2 mm",wall:"1 mm",
      },rear);
      const { ends } = cap.project.workspaces.capMounts[cap.capId];
      assert.equal(ends.start.threadMate.mating.featureId, "barrel");
      assert.equal(ends.end.threadMate.mating.featureId, "barrel");
    } finally { releaseBodies(model); }
    const after = await writingJob(cap.project,setup,"verify");
    assert.equal(after.caps, 1);
    const revised = { ...setup,projection:"1.7 mm" };
    const cleaned = withoutRefillBacking(withoutWritingSeat(cap.project,coneId),"barrel");
    const fresh = await writingJob(cleaned,revised,"measure");
    const shaped = shapeWritingSeat(cleaned,fresh.fit,revised).project;
    const replaced = applyWritingPose(addRefillBacking(shaped,fresh.backing,cap.project),fresh.fit);
    const proof = await writingJob(replaced,revised,"verify");
    assert.equal(proof.caps, 1);
    const { features } = await evaluateModel(replaced), bodies = buildBodies(features);
    try {
      const ids=features.filter(f=>f.operation==="new").map(f=>f.id);
      assert.equal(verifyCapPosting(replaced,cap.capId,bodies,ids),undefined);
    } finally { releaseBodies(bodies); }
  }
  console.log("PASS real annular backing at both ends, exact endplay, blind wall, cap threads, vent, alternate through-passage, offset Z and undoable native refit before and after adding a posting cap.");
} finally { await api.close(); }
