import assert from "node:assert/strict";
import { makeCylinder, measureVolume } from "replicad";
import { geometry, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { createThreadedCap, createThreadedCone, setCapMount, barrelEnd, compatiblePairSizes, recommendCapSeat, suggestCapFit, applyCapConeFit } = await api.load("threadedCone");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { threadMinorDiameter } = await api.load("finishingTypes");
  const { fitCapEnvelope } = await api.load("capSizing");
  const { evaluate, resolveParameters } = await api.load("expressions");
  const { resolveThreadMates } = await api.load("threadMates");
  const { buildPoses } = await api.load("kinematics");
  const { positioned } = await api.load("motionGeometry");
  const barrel = project([{ id:"s", name:"Sleeve", constraints:[],
    points:[[0,3.5],[0,5],[50,5],[50,3.5]].map(([x,y])=>({x:String(x),y:String(y)})) }],
    [{id:"barrel",name:"Barrel",kind:"revolve",sketchId:"s",amount:"360 deg",operation:"new",suppressed:false}]);
  const endStock = end => ({axis:"X",centerline:[0,0,0],station:end === "end" ? 50 : 0,outside:10,bore:7});
  const settings = {end:"end",size:"M8 × 0.75",length:"2.25 mm",allowance:"0.1 mm",mode:"cosmetic",
    capLength:"16 mm",capDiameter:"12 mm",crown:"flat",crownLength:"3 mm",wall:"1.5 mm"};
  const parametric = structuredClone(barrel);
  parametric.parameters = [{ name:"barrel_od", expression:"10 mm" }];
  for (const point of parametric.sketches[0].points) if (point.y === "5") point.y = "barrel_od / 2";
  const { collectFitSurfaces } = await api.load("fitSurfaces");
  const measuredBlank = buildBodies((await evaluateModel(parametric)).features);
  try {
    const faces = collectFitSurfaces(measuredBlank[0].shape, "barrel", true);
    const linked = createThreadedCap(parametric, "barrel", barrelEnd(faces, "X", "end"),
      { ...settings, matchBarrel:true }, barrelEnd(faces, "X", "start")).project;
    const larger = linked.parameters.map(p => p.name === "barrel_od" ? { ...p, expression:"11 mm" } : p);
    near(resolveParameters(larger).cap_diameter, 11, 1e-7, "a flush cap follows the original driven barrel diameter");
  } finally { releaseBodies(measuredBlank); }
  // An interrupted grip exposes only these complete turns of the outside
  // surface. A cap needs its stop on measured stock at both ends simultaneously.
  const land = (start, end, diameter = 10) => ({ side:"shaft", axis:[1,0,0], centerline:[0,0,0], start, end, diameter });
  const fitFaces = [land(0,2.6), land(3.5,4.4), land(6.1,13), land(37,44), land(45.7,46.4), land(47.7,50),
    { ...land(0,50,7), side:"bore" }];
  const recommend = (faces, length, od) => recommendCapSeat(barrel, "barrel", barrelEnd(faces, "X", "end"),
    barrelEnd(faces, "X", "start"), length, 0.1, od);
  const shared = recommend(fitFaces, 4.5);
  assert.equal(shared.length, 4.25, "both cap seats move onto measured lands");
  assert(compatiblePairSizes(barrel, "barrel", barrelEnd(fitFaces,"X","end"), "cap", barrelEnd(fitFaces,"X","start"), 0.1, shared.length).includes(shared.size));
  assert.equal(recommend(fitFaces, 4.123).length, 4.123, "keep an entered working length, including sub-grid precision");
  assert.equal(recommend(fitFaces, 4.5, 6), undefined, "a custom cap cannot be widened to force a thread");
  assert.equal(recommend([land(0,0.15), land(49.85,50)], 4.5), undefined, "no measured shoulder beyond one turn");
  assert.equal(recommend([land(0,0.45)], 4.5), undefined, "front and back need separate engagement and stop");
  const interrupted = [land(0,1),land(6,9),land(42,44.5),land(49.7,50),{...land(0,50,7),side:"bore"}];
  assert.equal(recommend(interrupted,4.5).length,6, "when no shorter engagement fits, use the next shared land");
  assert.equal(recommend([...interrupted, {...land(48,48.2,9.96), side:"bore"}],4.5), undefined,
    "a shoulder beyond a wide bore cannot repair thread stock missing along the engagement");
  const fitValues = resolveParameters([{ name: "desired", expression: "2 mm" }]);
  const fitInput = { ...settings, crown: "domed", crownLength: "8 mm", capLength: "desired",
    wall: "1.5 mm", length: "4 mm", capDiameter: "desired + 2 mm" };
  const fitted = fitCapEnvelope(fitInput, fitValues, 8);
  assert.equal(fitted.changes.length, 3);
  near(evaluate(fitted.settings.capDiameter, fitValues), 10, 1e-7, "fitted capDiameter");
  near(evaluate(fitted.settings.crownLength, fitValues), 5, 1e-7, "fitted crownLength");
  near(evaluate(fitted.settings.capLength, fitValues), 10.75, 1e-7, "fitted capLength");
  assert.match(fitted.settings.capLength, /desired/);
  assert.match(fitted.settings.capDiameter, /desired/);
  assert.deepEqual(fitCapEnvelope(fitted.settings, fitValues, 8).changes, []);
  assert.throws(() => fitCapEnvelope({ ...fitInput, wall: "missing_wall" }, fitValues, 8), /unknown parameter/i);
  const { insertRefill } = await api.load("refills");
  const withGel = insertRefill(barrel, "energel-lr7", {}, {bodyId:"gel"}).project;
  const coneSettings = {...settings, coneLength:"12 mm", tipDiameter:"4 mm", opening:"2 mm"};
  const gelFeature = withGel.features.find(f => f.id === "gel");
  gelFeature.name = "Barrel"; // Library identity must survive a rename.
  assert.deepEqual(compatiblePairSizes(withGel, "gel", endStock("end"), "cap", endStock("start")), []);
  assert.throws(() => createThreadedCap(withGel, "gel", endStock("end"), settings, endStock("start")), /Select the pen barrel/);
  assert.throws(() => createThreadedCone(withGel, "gel", endStock("end"), coneSettings), /Select the pen barrel/);

  const taper = {axis:[1,0,0], centerline:[0,0,0], side:"shaft", start:0, end:5, diameter:4, endDiameter:0};
  assert.equal(barrelEnd([taper], "X", "end"), undefined);
  assert.equal(barrelEnd([taper], "X", "start").outside, 4);
  const point = {...endStock("start"), outside:0, bore:0};
  assert.throws(() => createThreadedCap(barrel, "barrel", endStock("end"), settings, point), /flat, round end/);
  assert.deepEqual(compatiblePairSizes(barrel, "barrel", endStock("end"), "cap", point), []);
  const slim = {...endStock("start"), outside:6.4, bore:5.2};
  assert.deepEqual(compatiblePairSizes(barrel, "barrel", endStock("end"), "cap", slim), [],
    "The common thread must clear the larger bore and fit the smaller outside diameter");
  const slimOptions = compatiblePairSizes(barrel, "barrel", slim, "cap", {...slim, station:50});
  assert.deepEqual(slimOptions, ["1/4–28 UNF"]);
  assert.deepEqual(compatiblePairSizes(barrel, "barrel", slim, "cap", {...slim, station:50}, 0.2), []);
  assert(compatiblePairSizes(withGel, "barrel", endStock("end"), "cap", endStock("start")).includes("M8 × 0.75"));
  for (const [end,crown] of [["start","domed"],["end","domed"],["start","tapered"],["end","flat"]]) {
    const {project: pen,capId} = createThreadedCap(barrel,"barrel",endStock(end),{...settings,end,crown});
    const model = await evaluateModel(JSON.parse(JSON.stringify(pen)));
    const solids = buildBodies(model.features);
    try {
      assert.equal(solids.length,2);
      assert.equal(geometry(solids[1].shape).valid,true);
      assert.equal(geometry(solids[1].shape).solids,1);
      const r=6, h=crown==="flat"?0:3, pilot=threadMinorDiameter(8,.75)/2;
      const top = crown==="domed" ? h*(3*r*r+h*h)/6 : h*(r*r + r*r/2 + r*r/4)/3;
      const volume = Math.PI * ((16-h)*r*r + top - (16-h-1.5)*pilot*pilot);
      near(measureVolume(solids[1].shape),volume,1e-5,crown+" cap, cavity and solid crown");
      const bb = geometry(solids[1].shape).bbox;
      near(bb[1][0]-bb[0][0],16,1e-5,"cap length");
      const cap = pen.features.find(f=>f.id===capId);
      assert.equal(cap.finishes[0].side,"internal");
      assert.equal(pen.features[0].finishes[0].side,"external");
      if (crown==="domed") {
        const invalid={...pen,parameters:pen.parameters.map(p=>p.name==="cap_crown"?{...p,expression:"8 mm"}:p)};
        await assert.rejects(evaluateModel(invalid),/dome height/);
      }
    } finally { releaseBodies(solids); }
  }
  const wide = structuredClone(barrel);
  for (const point of wide.sketches[0].points) if (point.y === "5") point.y = "7.5";
  const wideStock = end => ({...endStock(end), outside:15});
  const nose = createThreadedCone(wide, "barrel", wideStock("end"), {...coneSettings, mode:"modeled"}).project;
  assert.deepEqual(compatiblePairSizes(nose, "barrel", wideStock("end"), "cap", wideStock("start")), [],
    "a flush cap cannot pass over a full-width nose");
  nose.parameters = nose.parameters.map(p => p.name === "cone_base" ? {...p, expression:"9 mm"} : p);
  assert(compatiblePairSizes(nose, "barrel", wideStock("end"), "cap", wideStock("start")).includes("M12 × 1"));
  const wideSleeve = structuredClone(wide);
  wideSleeve.parameters = [{ name:"barrel_od", expression:"15 mm" }];
  for (const point of wideSleeve.sketches[0].points) if (point.y === "7.5") point.y = "barrel_od / 2";
  const fullNose = createThreadedCone(wideSleeve,"barrel",wideStock("end"),{...coneSettings,size:"M12 × 1"}).project;
  // Original-diameter land at 1.75 mm on both ends; the nearby 5 mm seat
  // lies in the grip groove on the front, and the requested 4.5 mm is fluted.
  const mixed = [land(0,3,15),land(3,45.4,14.64),land(46,48,14.64),land(48,50,15), {...land(0,50,7),side:"bore"}];
  const front = barrelEnd(mixed,"X","end"), back = barrelEnd(mixed,"X","start");
  const proposal = suggestCapFit(fullNose,"barrel",front,back,4.5);
  assert.equal(proposal.size,"M14 × 1");
  near(proposal.length,1.75,1e-9,"choose both original-diameter shoulders when reducing a wide cone");
  near(proposal.cone.to,12.7,1e-9,"diametral clearance and the M12 cone seating shoulder");
  const changed = applyCapConeFit(fullNose,proposal.cone);
  assert.equal(resolveParameters(fullNose.parameters).cone_base,15,"proposal leaves the original cone in place");
  near(resolveParameters(changed.parameters).cone_base,12.7,1e-9,"accepted isolated cone base draft");
  near(resolveParameters(changed.parameters.map(p=>p.name==="barrel_od"?{...p,expression:"16 mm"}:p)).cone_base,13.7,1e-9,"preserve original cone diameter driver");
  assert(compatiblePairSizes(changed,"barrel",front,"cap",back,0.1,proposal.length).includes(proposal.size));
  assert.equal(suggestCapFit({...fullNose, parameters:[...fullNose.parameters,{name:"other",expression:"cone_base + 1 mm"}]},
    "barrel",front,back,4.5),undefined,"a shared cone driver cannot be automatically narrowed");
  assert.equal(suggestCapFit(fullNose,"barrel",front,back,4.5,0.1,10),undefined,"respect intentionally smaller cap dimensions");
  const outer = makeCylinder(5,50,[13,-7,0],[0,0,1]), bore = makeCylinder(3.5,50,[13,-7,0],[0,0,1]);
  const ring = outer.cut(bore);
  const zBarrel = project([], [{id:"barrel",name:"Offset Z sleeve",kind:"import",sketchId:"",suppressed:false,
    operation:"new",amount:"0",sourceId:"import",sourceIndex:0}], {importedFiles:[{id:"import",name:"sleeve.step",
    format:"step",bodies:[{name:"Offset Z sleeve",brep:ring.serialize()}]}]});
  [ring,outer,bore].forEach(s=>s.delete());
  for (const [base,front,hasNose] of [[barrel,"start",false],[nose,"end",true],[zBarrel,"end",false]]) {
    const rear=front==="start"?"end":"start";
    const dims = {...settings,end:front,length:"4.5 mm",mode:"modeled",crown:"domed",matchBarrel:true,
      ...(hasNose ? {size:"M12 × 1",length:"2.4 mm",capLength:"24 mm"} : {})};
    const stock = end => base === zBarrel ? {...endStock(end),axis:"Z",centerline:[13,-7,0]} : hasNose ? wideStock(end) : endStock(end);
    const {project: pen,capId} = createThreadedCap(base,"barrel",stock(front),dims,stock(rear));
    const model = await evaluateModel(pen);
    const solids = buildBodies(model.features);
    try {
      const ids=model.features.filter(f=>f.operation==="new").map(f=>f.id);
      const frames=solids.flatMap(b=>b.threadFrames ?? []);
      assert.equal(ids.length,hasNose?3:2,"only one cap component");
      const bbox = geometry(solids[0].shape).bbox;
      for (const axis of (base === zBarrel ? [0,1] : [1,2])) {
        near(bbox[1][axis]-bbox[0][axis],stock(front).outside,1e-5,"flush threads respect stock diameter");
      }
      assert.equal(pen.workspaces.capMounts[capId].front,front);
      assert.equal(pen.workspaces.capMounts[capId].active,front);
      for (const end of [front,rear]) {
        const mounted=setCapMount(pen,capId,end);
        assert.equal(mounted.workspaces.capMounts[capId].active,end);
        const config=resolveThreadMates(mounted.workspaces.joints,frames,model.values,ids);
        const localSign=front==="start"?-1:1;
        let home;
        for (const turns of [0,.25,1]) {
          const poses=buildPoses(ids,config,{[capId]:[localSign*360*turns]},model.values);
          const m=poses[ids.indexOf(capId)];
          const axial = m[base === zBarrel ? 14 : 12];
          if (turns===0) home=axial;
          near(axial-home,(end==="start"?-1:1)*turns*model.values.cap_pitch,1e-6,"posting orientation and screw lead");
          const placed=positioned(solids[ids.indexOf(capId)].shape,m);
          try {
            if (turns===0) {
              const bounds = geometry(placed).bbox, axis = base === zBarrel ? 2 : 0;
              const rim = stock(end).station + (end === "start" ? 1 : -1) * model.values.cap_thread_length;
              near(bounds[end === "start" ? 1 : 0][axis], rim, 1e-5, "cap mouth reaches the original seating shoulder");
              near(bounds[1][1] - bounds[0][1], stock(end).outside, 1e-5, "closed and posted cap match the original outside diameter");
            }
            for (let i=0;i<ids.length;i++) {
              if (ids[i]===capId) continue;
              const other=positioned(solids[i].shape,poses[i]);
              try {
                const common=placed.intersect(other);
                try { near(Math.abs(measureVolume(common)),0,1e-5,"clear of "+ids[i]+" on "+end+" at "+turns+" turns"); }
                finally { common.delete(); }
              } finally { other.delete(); }
            }
          } finally { placed.delete(); }
        }
      }
    } finally { releaseBodies(solids); }
  }
  // A snapped donor has a real collar bearing on the original mouth. New
  // posting threads must leave this contact and the ink passage intact.
  const { seatRefill } = await api.load("refillSeating");
  const { makeRefillSnapJoint } = await api.load("assemblyRefillSnap");
  const { verifyRefillSeat } = await api.load("refillSeatingGeometry");
  const { verifyCapPosting } = await api.load("capClearanceGeometry");
  const sleeve = structuredClone(barrel);
  sleeve.sketches[0].points = [[0,2.05],[0,5],[135,5],[135,2.05]].map(([x,y])=>({x:String(x),y:String(y)}));
  const donorPen = insertRefill(sleeve,"bic-round-stic",{},{bodyId:"donor"}).project;
  const seated = seatRefill(donorPen,"donor",{bodyId:"barrel",axis:[1,0,0],centerline:[0,0,0],diameter:4.1,
    station:0,end:"start",key:"mouth"});
  donorPen.workspaces.joints = {donor:makeRefillSnapJoint({},"donor","barrel",seated)};
  const {project: capped,capId} = createThreadedCap(donorPen,"barrel",{...endStock("start"),bore:4.1},
    {...settings,end:"start",capDiameter:"10 mm",capLength:"25 mm"},
    {...endStock("end"),station:135,bore:4.1});
  const combined = await evaluateModel(capped);
  const parts = buildBodies(combined.features);
  try {
    verifyRefillSeat(parts[1].shape,parts[0].shape,seated.toArray());
    verifyCapPosting(capped,capId,parts,combined.features.filter(f=>f.operation==="new").map(f=>f.id));
    const mouths=parts[0].threadFrames.map(frame=>frame.entrance[0]).sort((a,b)=>a-b);
    near(mouths[0],0,1e-6,"donor mouth");
    near(mouths[1],135,1e-6,"rear posting thread");
  } finally { releaseBodies(parts); }
  for (const [changes,error] of [[{capDiameter:"8 mm"},/outside diameter/],[{capLength:"3 mm"},/Leave room/],
    [{allowance:".4 mm"},/thread root/],[{crown:"domed",crownLength:"7 mm"},/dome height/]]) {
    assert.throws(()=>createThreadedCap(barrel,"barrel",endStock("end"),{...settings,...changes}),error);
  }
  console.log("PASS flat, tapered and spherical caps, exact volumes, solid roof, live dimensional limits and modeled screw fit at both barrel ends.");
} finally { await api.close(); }
