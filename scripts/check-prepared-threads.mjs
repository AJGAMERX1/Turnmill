import assert from "node:assert/strict";
import { makeCylinder } from "replicad";
import { geometry, near, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { evaluateFinish, threadMinorDiameter } = await api.load("finishingTypes");
  const { buildBodies, exportBodies, releaseBodies } = await api.load("geometry");
  const { importSolidFile } = await api.load("exchangeSolids");
  const { resolveThreadMates } = await api.load("threadMates");
  const reach = 2.25, pitch = .75, major = 8, pilot = threadMinorDiameter(major, pitch);
  const base = { id:"cone", name:"Grip cone", kind:"revolve", operation:"new", amount:360, points:[[0,1.5],[0,6],[12,4],[12,1.5]] };
  const cap = { ...base, id:"barrel",name:"Barrel",points:[[16,3.5],[16,5],[40,5],[40,3.5]] };
  const coneVolume = Math.PI * 12 * ((6 ** 2 + 6 * 4 + 4 ** 2) / 3 - 1.5 ** 2);
  const barrelVolume = Math.PI * (25 - 3.5 ** 2) * 24;
  const tenonVolume = Math.PI * (4 ** 2 - 1.5 ** 2) * reach;
  const pilotVolume = Math.PI * ((pilot / 2) ** 2 - 3.5 ** 2) * reach;
  const backWall = Math.PI * 3.5 ** 2 * 1.5;
  const prep = (preparation, end, extra={}) => evaluateFinish({
    kind:"thread",id:preparation,name:preparation,preset:"M8 × 0.75", side:preparation==="socket"?"internal":"external",
    mode:"cosmetic",hand:"right",preparation,preparationAxis:"X",diameter:"8 mm",pitch:"0.75 mm",length:"3 * pitch",end,...extra
  }, {pitch});
  const inspect = (stock, finish) => {
    const bodies = buildBodies([{...stock,finishes:[finish]}]);
    try { return { ...geometry(bodies[0].shape), thread:bodies[0].threadFrames[0] }; }
    finally { releaseBodies(bodies); }
  };
  for (const end of ["start","end"]) {
    const tenon = inspect(base,prep("tenon",end));
    assert(tenon.valid && tenon.solids===1);
    near(tenon.volume,coneVolume+tenonVolume,1e-5,"Independent annular tenon from cone shoulder");
    near(tenon.bbox[end==="start"?0:1][0],end==="start"?-reach:12+reach,1e-6,"Cone extends outward");
    near(tenon.thread.entrance[0],end==="start"?-reach:12+reach,1e-7,"Movable mate entrance");
    const turned = inspect(cap, prep("flush",end));
    assert(turned.valid && turned.solids === 1);
    near(turned.volume, barrelVolume - Math.PI * (25 - 16) * reach, 1e-5, "Only the outside of the end band is turned");
    near(turned.thread.entrance[0], end === "start" ? 16 : 40, 1e-7, "The end face is the cap mating datum");
    const expectedBounds = [[16,-5,-5],[40,5,5]];
    turned.bbox.forEach((corner,i) => corner.forEach((v,j) => near(v,expectedBounds[i][j],1e-6,"Original barrel envelope")));
    const socket=inspect(cap,prep("socket",end,{backWall:"1.5 mm"}));
    assert(socket.valid && socket.solids===1);
    near(socket.volume,barrelVolume-pilotVolume+backWall,1e-5,"Open socket and closed opposite bore");
    near(socket.thread.entrance[0],end==="start"?16:40,1e-7,"Cap mate entrance");
    near(socket.bbox[0][0],16,1e-7,"Original length"); near(socket.bbox[1][0],40,1e-7,"Original length");
    near(inspect(cap,prep("socket",end)).volume,barrelVolume-pilotVolume,1e-5,"Optional back leaves sleeve open");
  }
  assert.throws(() => inspect(cap, prep("flush","start",{diameter:"11 mm"})), /original stock/);
  assert.throws(() => inspect(cap, prep("flush","end",{diameter:"7.5 mm"})), /bore/);
  assert.throws(() => inspect(cap, prep("flush","end",{diameter:"10 mm"})), /shoulder/);
  const blind = {...cap, points:[[16,3.5],[16,5],[40,5],[40,0],[39,0],[39,3.5]]};
  near(inspect(blind,prep("socket","start",{backWall:"1.5 mm"})).volume,barrelVolume-pilotVolume+backWall,1e-5,"Thickening a 1 mm blind back");
  near(inspect(blind,prep("socket","start",{backWall:"0.5 mm"})).volume,barrelVolume-pilotVolume+backWall/1.5,1e-5,"A thicker existing back is preserved");
  assert.throws(()=>inspect(cap,prep("socket","start",{backWall:"23 mm"})),/shorten the thread|back wall/i);
  assert.throws(()=>inspect(base,prep("tenon","end",{diameter:"9 mm"})),/wider than this end/);
  assert.throws(()=>inspect(cap,prep("tenon","end",{diameter:"7.5 mm"})),/break through the bore/);
  assert.throws(()=>inspect(cap,prep("socket","end",{diameter:"7.5 mm"})),/existing bore/);
  const pointed={...base, points:[[0,0],[0,6],[12,0]]};
  assert.throws(()=>inspect(pointed,prep("tenon","end")),/flat, round end/);

  const source = buildBodies([cap]);
  try {
    const tool = makeCylinder(0.15,24,[16,4.5,0],[1,0,0]);
    const drilled = source[0].shape.cut(tool);
    try {
      const withVent = {...cap,kind:"import",brep:drilled.serialize(),points:[]};
      const closed = inspect(withVent,prep("socket","start",{backWall:"1.5 mm"}));
      near(closed.volume,barrelVolume-pilotVolume+backWall - Math.PI * .15 ** 2 * 24,1e-5,"Closing the central bore retains a parallel vent hole");
    } finally { drilled.delete(); tool.delete(); }
    const reoriented = source[0].shape.clone().rotate(-90,[0,0,0],[0,1,0]).translate([31,-17,0]);
    try {
      const imported = {...cap,kind:"import",brep:reoriented.serialize(),points:[]};
      const turned = inspect(imported,prep("flush","end",{preparationAxis:"Z", preparationCenter:[31,-17,0], mode:"modeled"}));
      assert(turned.valid && turned.solids === 1);
      assert(turned.volume < barrelVolume - Math.PI * (25 - 16) * reach - .01);
      [31,-17,40].forEach((v,i) => near(turned.thread.entrance[i],v,1e-6,"Off-center Z thread entrance"));
      [[26,-22,16],[36,-12,40]].forEach((corner,i) =>
        corner.forEach((v,j) => near(turned.bbox[i][j],v,1e-6,"Off-center Z barrel envelope")));
    } finally { reoriented.delete(); }
    const shifted = source[0].shape.clone().translate([0, 31, -17]);
    try {
      const imported = {...cap,kind:"import",brep:shifted.serialize(),points:[]};
      const props = inspect(imported,prep("socket","start",{preparationCenter:[123,31,-17],backWall:"1.5 mm"}));
      assert(props.valid && props.solids === 1);
      assert.deepEqual(props.thread.entrance,[16,31,-17]);
      near(props.volume,barrelVolume-pilotVolume+backWall,1e-5,"Off-origin imported barrel socket and closed rear");
    } finally { shifted.delete(); }
  } finally { releaseBodies(source); }
  assert.throws(()=>prep("socket","start",{preparationCenter:[42,NaN,12]}),/centerline/);

  const { projectSolid } = await api.load("secondaryProjection");
  const { manufacturingSheets } = await api.load("secondaryManufacturing");
  const drawing = {title:"Cone",number:"",revision:"",material:"Brass",note:"",scale:"auto",dimensions:true,hatch:false,measures:[]};
  const drawingBodies = buildBodies([base]);
  try {
    const projection = projectSolid(drawingBodies[0].shape);
    const texts = finish => manufacturingSheets(projection, drawing, [{...base,finishes:[finish]}], "").sheets.flatMap(
      ({sheet}) => sheet.marks.filter(m => m.type === "text").map(m => m.value));
    const standard = prep("socket","start",{backWall:"1.5 mm"});
    assert(texts(standard).some(s=>s.startsWith("M8 × 0.75 · internal")));
    assert(texts(prep("flush","end")).some(s=>s.includes("original barrel OD")));
    assert(texts(standard).includes("Solid back wall · 1.5 mm minimum at opposite end"));
    assert(texts(standard).some(s=>s.startsWith("Socket pilot Ø7.188101 mm")));
    const undersize = prep("tenon","end",{diameter:"7.90 mm"});
    assert(texts(undersize).some(s=>s.startsWith("Ø 7.9 × 0.75 pitch · external")));
    const changed = texts({...standard,pitch:1});
    assert(changed.some(s=>s.startsWith("Ø 8 × 1 pitch · internal")));
    assert(changed.every(s=>!s.includes("M8 × 0.75")));
  } finally { releaseBodies(drawingBodies); }

  const bodies=buildBodies([{...base,finishes:[prep("tenon","start",{mode:"modeled"})]},
    {...cap,finishes:[prep("socket","end",{backWall:"1.5 mm",mode:"modeled"})]}]);
  try {
    assert.equal(bodies.length,2);
    const frames=bodies.flatMap(b=>b.threadFrames);
    const [male,female]=bodies.map(b=>geometry(b.shape));
    assert(male.valid && female.valid && male.solids===1 && female.solids===1);
    assert(male.volume<coneVolume+tenonVolume-.01 && male.volume>coneVolume);
    assert(female.volume<barrelVolume-pilotVolume+backWall-.01);
    const joints=resolveThreadMates({cone:{parent:"barrel",threadMate:{moving:frames[0],mating:frames[1],placement:"entrances",engagement:"0",phase:"0"}}},frames,{},["cone","barrel"]);
    assert.equal(joints.cone.pitch,"0.75");
    assert.deepEqual(joints.cone.origin.map(Number),[-reach,0,0]);
    const step=await importSolidFile("step",exportBodies(bodies,"step"),"Pen connection");
    try { assert.equal(step.length,2); step.map(b=>geometry(b.shape).volume).sort((a,b)=>a-b).forEach((v,i)=>near(v,[male.volume,female.volume].sort((a,b)=>a-b)[i],0.003,"STEP round trip")); }
    finally { releaseBodies(step); }
  } finally { releaseBodies(bodies); }
  console.log("PASS threaded cone tenons, preserved refill bores, cap socket and optional back wall, modeled helices, mates and STEP export");
} finally { await api.close(); }
