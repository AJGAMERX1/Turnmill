import assert from "node:assert/strict";
import { makeCylinder, measureVolume } from "replicad";
import { geometry, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { createThreadedCap, createThreadedCone, capNeedsCollars, setCapMount, barrelEnd, compatiblePairSizes } = await api.load("threadedCone");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { threadMinorDiameter } = await api.load("finishingTypes");
  const { resolveThreadMates } = await api.load("threadMates");
  const { buildPoses } = await api.load("kinematics");
  const { positioned } = await api.load("motionGeometry");
  const barrel = project([{ id:"s", name:"Sleeve", constraints:[],
    points:[[0,3.5],[0,5],[50,5],[50,3.5]].map(([x,y])=>({x:String(x),y:String(y)})) }],
    [{id:"barrel",name:"Barrel",kind:"revolve",sketchId:"s",amount:"360 deg",operation:"new",suppressed:false}]);
  const endStock = end => ({axis:"X",centerline:[0,0,0],station:end === "end" ? 50 : 0,outside:10,bore:7});
  const settings = {end:"end",size:"M8 × 0.75",length:"2.25 mm",allowance:"0.1 mm",mode:"cosmetic",
    capLength:"16 mm",capDiameter:"12 mm",crown:"flat",crownLength:"3 mm",wall:"1.5 mm"};
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
  // With a screw-on nose the same pair is built around the barrel on external collars.
  const nose = createThreadedCone(barrel,"barrel",endStock("end"),{...settings,
    coneLength:"12 mm",tipDiameter:"4 mm",opening:"2 mm",mode:"modeled"}).project;
  assert(capNeedsCollars(nose,"barrel"));
  assert.equal(compatiblePairSizes(nose,"barrel",endStock("end"),"cap",endStock("start"))[0],"M12 × 1");
  const outer = makeCylinder(5,50,[13,-7,0],[0,0,1]), bore = makeCylinder(3.5,50,[13,-7,0],[0,0,1]);
  const ring = outer.cut(bore);
  const zBarrel = project([], [{id:"barrel",name:"Offset Z sleeve",kind:"import",sketchId:"",suppressed:false,
    operation:"new",amount:"0",sourceId:"import",sourceIndex:0}], {importedFiles:[{id:"import",name:"sleeve.step",
    format:"step",bodies:[{name:"Offset Z sleeve",brep:ring.serialize()}]}]});
  [ring,outer,bore].forEach(s=>s.delete());
  for (const [base,front,collars] of [[barrel,"start",false],[nose,"end",true],[zBarrel,"end",false]]) {
    const rear=front==="start"?"end":"start";
    const dims = {...settings,end:front,length:"4.5 mm",mode:"modeled",crown:"domed",
      ...(collars ? {size:"M12 × 1",length:"2.4 mm",capLength:"24 mm",capDiameter:"14 mm"} : {})};
    const stock = end => base === zBarrel ? {...endStock(end),axis:"Z",centerline:[13,-7,0]} : endStock(end);
    const {project: pen,capId} = createThreadedCap(base,"barrel",stock(front),dims,stock(rear));
    const model = await evaluateModel(pen);
    const solids = buildBodies(model.features);
    try {
      const ids=model.features.filter(f=>f.operation==="new").map(f=>f.id);
      const frames=solids.flatMap(b=>b.threadFrames ?? []);
      assert.equal(ids.length,collars?3:2,"only one cap component");
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
          near(axial-home,(end==="start"?-1:1)*turns*(collars?1:.75),1e-6,"posting orientation and screw lead");
          const placed=positioned(solids[ids.indexOf(capId)].shape,m);
          try {
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
  assert(capNeedsCollars(donorPen,"barrel"));
  const {project: capped,capId} = createThreadedCap(donorPen,"barrel",{...endStock("start"),bore:4.1},
    {...settings,end:"start",size:"M12 × 1",capDiameter:"14 mm",capLength:"25 mm"},
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
