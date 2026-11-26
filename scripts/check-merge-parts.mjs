import assert from "node:assert/strict";
import { Matrix4 } from "three";
import { boxSketch, feature, geometry, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { mergeParts } = await api.load("mergeParts");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies, exportBodies } = await api.load("geometry");
  const { validateProject } = await api.load("projects");
  const { ModelBodies } = await api.load("modelBodies");
  const { buildPoses, defaultJoint } = await api.load("kinematics");
  const { importSolidFile } = await api.load("exchangeSolids");
  const target = feature("base", "base-profile", 2);
  const tool = feature("lug", "lug-profile", "lug_height");
  const sketches = [
    boxSketch("base-profile", 0, 0, 10, 4),
    boxSketch("lug-profile", 0, 0, 4, 2),
  ];
  const source = project(sketches, [target, tool], {
    parameters: [{ name: "lug_height", expression: "2 mm" }],
  });
  const translation = (x, y = 0, z = 0) => new Matrix4().makeTranslation(x, y, z).toArray();
  const original = structuredClone(source);
  const fuse = (transform, input = source) => mergeParts(input, "base", "lug", transform);

  async function readSolid(input, expected, step = false) {
    const model = await evaluateModel(input);
    const bodies = buildBodies(model.features);
    try {
      assert.equal(bodies.length, 1, "one output body");
      const solid = geometry(bodies[0].shape);
      assert(solid.valid && solid.solids === 1, "one connected valid solid");
      near(solid.volume, expected, 1e-6, "union volume");
      if (step) {
        const read = await importSolidFile("step", exportBodies(bodies, "step"), "merged");
        try {
          assert.equal(read.length, 1, "one STEP product");
          const roundTrip = geometry(read[0].shape);
          assert(roundTrip.valid && roundTrip.solids === 1, "one manufactured solid after STEP import");
          near(roundTrip.volume, expected, .0001, "STEP union volume");
        } finally { releaseBodies(read); }
      }
      return solid;
    } finally { releaseBodies(bodies); }
  }

  // A 10 × 4 × 2 base joins a 4 × 2 × 2 lug. Test union, not volume summation.
  await readSolid(fuse(translation(8)), 88);
  await readSolid(fuse(translation(2)), 80); // fully enclosed
  for (const transform of [translation(11), translation(10, 4), translation(10, 4, 2)]) {
    await assert.rejects(() => readSolid(fuse(transform), 96),
      e => e instanceof Error && e.code !== "ERR_ASSERTION" && /face|overlap|touch|solid|connect/i.test(e.message),
      "separated, edge-only and point-only contact cannot form a single part");
  }

  // Rotate the lug about Z. Its local 4 mm side runs along the base's 4 mm face.
  const localPose = new Matrix4().makeRotationZ(Math.PI / 2).setPosition(12, 0, 0).toArray();
  const merged = validateProject(JSON.parse(JSON.stringify(fuse(localPose))));
  const result = await readSolid(merged, 96, true);
  near(result.bbox[1][0], 12, 1e-6, "face-contact union at the captured rotation");
  near(result.center[0], 6, 1e-6, "center of merged block");
  assert.deepEqual(source, original, "failed and successful merges leave the undo source intact");
  assert.equal(merged.features.filter(f => f.operation === "new").length, 1);

  const toolBodies = buildBodies((await evaluateModel({...source,features:[tool]})).features);
  try {
    const step = exportBodies(toolBodies, "step");
    const stored = {id:"step-source", name:"lug.step", format:"step",
      data:Buffer.from(await step.arrayBuffer()).toString("base64"),
      bodies:[{name:"Lug",brep:toolBodies[0].shape.serialize()}]};
    const imported = {...source, importedFiles:[stored], features:[target,{
      ...tool, kind:"import", sketchId:"", sourceId:stored.id, sourceIndex:0,
    }]};
    await readSolid(validateProject(JSON.parse(JSON.stringify(fuse(localPose, imported)))),96);
  } finally { releaseBodies(toolBodies); }

  const afterCut = { ...merged,
    sketches:[...merged.sketches,boxSketch("relief-profile",10.5,1,11.5,3)],
    features:[...merged.features, { ...feature("relief","relief-profile",1), operation:"cut", bodyId:"base" }] };
  await readSolid(afterCut, 94); // remove 1 × 2 × 1 solely from the formerly separate lug

  const resized = { ...merged, parameters: [{ name:"lug_height", expression:"3 mm" }] };
  const cache = new ModelBodies();
  try {
    cache.build((await evaluateModel(merged)).features);
    cache.build((await evaluateModel(resized)).features);
    assert.equal(cache.bodies.length, 1);
    near(geometry(cache.bodies[0].shape).volume, 104, 1e-6, "parameter edit rebuilds consumed tool through cache");
  } finally { cache.clear(); }

  // The tool can be a mounting point for other moving components. Keep their motion
  // relative to the same world frame after their original parent becomes solid stock.
  const thirdPart = feature("knob","knob-profile",1);
  const jointed = { ...source, sketches:[...source.sketches,boxSketch("knob-profile",0,0,1,1)],
    features:[...source.features,thirdPart], workspaces:{joints:{
      base:{...defaultJoint(), placement:{position:["50","20","0"], rotation:["0","0","90 deg"]}},
      lug:{...defaultJoint(), parent:"base", placement:{position:["12","0","0"], rotation:["0","0","90 deg"]}},
      knob:{...defaultJoint(), kind:"slider", parent:"lug", axis:"X", max:"4 mm", offset:["3","0","0"]},
    }} };
  const reparented = fuse(localPose, jointed);
  assert.equal(reparented.workspaces.joints.knob.parent, "base");
  for (const x of [0,1.5,4]) {
    const drivers = {knob:[x]};
    const world = buildPoses(["base","lug","knob"],jointed.workspaces.joints,drivers,{})[2];
    const moved = buildPoses(["base","knob"],reparented.workspaces.joints,drivers,{})[1];
    world.forEach((n,i) => near(moved[i], n, 1e-7, "child's world pose throughout travel"));
  }

  const third = feature("end", "end-profile", 2);
  const three = { ...merged, sketches:[...merged.sketches,boxSketch("end-profile",12,0,16,4)],
    features:[...merged.features,third] };
  const chain = mergeParts(three, "end", "base", translation(0));
  const saved = validateProject(JSON.parse(JSON.stringify(chain)));
  await readSolid(saved, 128);
  console.log("PASS overlapping, contained and face-joined parts, rejected gaps/edge/point contacts, transformations, parametric nested history and single-solid STEP.");
} finally { await api.close(); }
