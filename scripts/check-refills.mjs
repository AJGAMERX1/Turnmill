import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { setOC } from "replicad";
import { Matrix4 } from "three";

const solver = fileURLToPath(
  import.meta.resolve("@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm"),
);
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  plugins: [
    {
      name: "local-solver-url",
      enforce: "pre",
      load(id) {
        if (id.endsWith("/planegcs.wasm?url"))
          return `export default ${JSON.stringify(solver)}`;
      },
    },
  ],
});
const near = (a, b) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${a} should equal ${b}`);
try {
  setOC(
    await initOC({
      wasmBinary: await readFile(
        new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
      ),
    }),
  );
  const { insertRefill, refillComponents, refillDimensions, refillMassGrams, reverseRefill } =
    await server.ssrLoadModule("/src/refills.ts");
  const { blankProject, validateProject } =
    await server.ssrLoadModule("/src/projects.ts");
  const { evaluateModel } = await server.ssrLoadModule("/src/buildModel.ts");
  const { buildBodies, releaseBodies, exportBodies } =
    await server.ssrLoadModule("/src/geometry.ts");
  const { defaultJoint, buildPoses } =
    await server.ssrLoadModule("/src/kinematics.ts");
  const start = blankProject();
  const parker = insertRefill(
    start,
    "parker-g2",
    {},
    { bodyId: "bolt-refill", prefix: "refill" },
  );
  assert.equal(start.parameters.length, 0);
  const project = parker.project;
  const sketchId = project.sketches[0].id;
  const joint = {
    ...defaultJoint(),
    kind: "slider",
    axis: "X",
    min: "0 mm",
    max: "4 mm",
  };
  project.workspaces.joints = { [parker.bodyId]: joint };
  project.workspaces.jointPose = { [parker.bodyId]: [3] };
  project.parameters.push({
    name: "chamber_length",
    expression: "refill_length + 2 mm",
  });
  const energel = insertRefill(
    project,
    "energel-lr7",
    {},
    { replaceBodyId: parker.bodyId },
  );
  const donor = {
    length: "5 in",
    body_diameter: "3.25 mm",
    guide_diameter: "2.3 mm",
    shoulder_distance: "1/4 in",
  };
  const bic = insertRefill(energel.project, "bic-cristal", donor, {
    replaceBodyId: parker.bodyId,
    mass: "1 g + 250 mg",
  });
  assert.equal(refillMassGrams(project, parker.bodyId), undefined);
  near(refillMassGrams(energel.project, energel.bodyId), 2.6);
  near(refillMassGrams(bic.project, bic.bodyId), 1.25);
  assert.throws(
    () => insertRefill(start, "bic-cristal"),
    /Measure tip to tail/,
  );
  assert.throws(
    () => insertRefill(start, "energel-lr7", { shoulder_distance: "120 mm" }),
    /shoulder/,
  );
  assert.throws(
    () => insertRefill(start, "parker-g2", { guide_diameter: "5 deg" }),
    /length/,
  );
  assert.throws(
    () => insertRefill(start, "parker-g2", {}, { replaceBodyId: "stale" }),
    /Select a refill/,
  );
  const added = insertRefill(energel.project, "energel-lr7");
  assert.equal(refillComponents(added.project).length, 2);
  assert.notEqual(
    refillComponents(added.project)[0].prefix,
    refillComponents(added.project)[1].prefix,
  );
  assert.equal(added.project.features[0], energel.project.features[0]);
  // Each catalog envelope has a plane at the flat tail and a single vertex at the writing end.
  function checkEnds(shape, length, tailX, tailDiameter) {
    const box = shape.boundingBox;
    try {
      const [lo, hi] = box.bounds;
      near(lo[0], 0);
      near(hi[0], length);
    } finally { box.delete(); }
    const faces = shape.faces;
    const ends = [];
    try {
      for (const face of faces) {
        const bounds = face.boundingBox;
        try {
          const [lo, hi] = bounds.bounds;
          const x = (hi[0] + lo[0]) / 2;
          if (hi[0] - lo[0] < 1e-5 && (Math.abs(x) < 1e-5 || Math.abs(x - length) < 1e-5))
            ends.push({ x, diameter: hi[1] - lo[1] });
        } finally { bounds.delete(); }
      }
    } finally { faces.forEach(face => face.delete()); }
    assert.equal(ends.length, 1, "exactly one axial endpoint has a flat tail");
    near(ends[0].x, tailX);
    near(ends[0].diameter, tailDiameter);
  }
  const flipped = reverseRefill(added.project, energel.bodyId);
  assert.deepEqual(flipped.parameters, added.project.parameters);
  assert.deepEqual(flipped.workspaces.joints, added.project.workspaces.joints);
  assert.deepEqual(flipped.workspaces.jointPose, added.project.workspaces.jointPose);
  const restored = reverseRefill(flipped, energel.bodyId);
  const { importSolidFile } = await server.ssrLoadModule("/src/exchangeSolids.ts");
  const changedLength = { ...flipped, parameters: flipped.parameters.map(param =>
    param.name === "refill_length" ? { ...param, expression: "120 mm" } : param) };
  const replaced = insertRefill(flipped, "parker-g2", {}, {replaceBodyId: energel.bodyId}).project;
  for (const [part, length, tailX, diameter] of [
    [added.project, 111, 111, 6.35],
    [validateProject(JSON.parse(JSON.stringify(flipped))), 111, 0, 6.35],
    [restored, 111, 111, 6.35],
    [changedLength, 120, 0, 6.35],
    [replaced, 98.1, 0, 6],
  ]) {
    const bodies = buildBodies((await evaluateModel(part)).features);
    try {
      checkEnds(bodies[0].shape, length, tailX, diameter);
      checkEnds(bodies[1].shape, 111, 111, 6.35);
      if (part === replaced) {
        const file = exportBodies([bodies[0]], "step");
        const imported = await importSolidFile("step", file, "Reversed G2");
        try { checkEnds(imported[0].shape, length, tailX, diameter); }
        finally { releaseBodies(imported); }
      }
    } finally { releaseBodies(bodies); }
  }
  // Pre-sleeve project files contain only the original eleven cartridge dimensions.
  const originalKeys = ["length", "body_diameter", "guide_diameter", "shoulder_distance",
    "body_start", "neck_diameter", "cone_length", "reservoir_front_diameter",
    "reservoir_taper", "tail_diameter", "tail_length"];
  const legacy = JSON.parse(JSON.stringify(bic.project));
  legacy.parameters = legacy.parameters.filter(p => p.name === "chamber_length" ||
    originalKeys.some(key => p.name === "refill_" + key));
  const restoredBare = validateProject(legacy);
  const legacyBody = buildBodies((await evaluateModel(restoredBare)).features);
  try {
    checkEnds(legacyBody[0].shape, 127, 127, 3.25);
    const box = legacyBody[0].shape.boundingBox;
    try { near(box.bounds[1][1] - box.bounds[0][1], 3.25); }
    finally { box.delete(); }
    assert.equal(restoredBare.workspaces.refills[bic.bodyId].kind, "bic-cristal");
  } finally { releaseBodies(legacyBody); }

  const initiallyReversed = insertRefill(start, "bic-cristal", donor, { reversed: true });
  const insertedSolids = buildBodies((await evaluateModel(initiallyReversed.project)).features);
  try { checkEnds(insertedSolids[0].shape, 127, 0, 3.25); }
  finally { releaseBodies(insertedSolids); }
  const cases = [
    [parker, 98.1, 6, 2.54],
    [energel, 111, 6.35, 2.27],
    [bic, 127, 3.25, 2.3],
  ];
  for (const [result, length, diameter, guide] of cases) {
    const p = validateProject(JSON.parse(JSON.stringify(result.project)));
    assert.equal(result.bodyId, "bolt-refill");
    assert.equal(p.features.length, 1);
    assert.equal(p.sketches[0].id, sketchId);
    const { features, values } = await evaluateModel(p);
    near(values.chamber_length, length + 2);
    const dims = refillDimensions(p, result.bodyId);
    near(dims.guide_diameter, guide);
    const poses = buildPoses(
      [result.bodyId],
      p.workspaces.joints,
      p.workspaces.jointPose,
      values,
    );
    near(poses[0][12], 3);
    const bodies = buildBodies(features);
    try {
      assert.equal(bodies.length, 1);
      const box = bodies[0].shape.boundingBox;
      try {
        const [lo, hi] = box.bounds;
        near(lo[0], 0);
        near(hi[0], length);
        near(hi[1] - lo[1], diameter);
      } finally {
        box.delete();
      }
      assert.match(
        await exportBodies(bodies, "step").text(),
        /MANIFOLD_SOLID_BREP/,
      );
      assert.ok(exportBodies(bodies, "stl").size > 84);
    } finally {
      releaseBodies(bodies);
    }
  }
  const edited = structuredClone(bic.project);
  edited.features[0].name = "My donor";
  edited.sketches[0].name = "Measured Cristal section";
  edited.parameters.find((p) => p.name === "refill_cone_length").expression =
    "1.8 mm";
  const revised = insertRefill(edited, "bic-cristal", donor, {
    replaceBodyId: bic.bodyId,
    mass: "1500 mg",
  }).project;
  assert.equal(revised.sketches[0], edited.sketches[0]);
  assert.equal(revised.features[0].name, "My donor");
  near(refillDimensions(revised, bic.bodyId).cone_length, 1.8);
  const { boltPenProject } = await server.ssrLoadModule("/src/boltPen.ts");
  const bolt = boltPenProject();
  // A synthetic caliper sample with an integral plastic tip holder. All dimensions
  // are deliberately distinct so a swapped tube, collar or shank fails the fit test.
  const sleeveDonor = {
    length: "130 mm", body_diameter: "3 mm", guide_diameter: "2 mm",
    shoulder_distance: "4 mm", nose_front_diameter: "3 mm",
    seat_distance: "12 mm", collar_diameter: "7.5 mm", lip_length: "0.8 mm",
    shank_diameter: "0.68 cm", shank_length: "8 mm",
  };
  const { collectFitSurfaces } = await server.ssrLoadModule("/src/fitSurfaces.ts");
  const { refillBoreChecks } = await server.ssrLoadModule("/src/refillClearance.ts");
  const identity = new Matrix4().toArray();
  for (const kind of ["bic-round-stic", "bic-cristal-original"]) {
    const preset = insertRefill(start, kind);
    const presetDimensions = refillDimensions(preset.project, preset.bodyId);
    const presetBodies = buildBodies((await evaluateModel(preset.project)).features);
    try {
      checkEnds(presetBodies[0].shape, presetDimensions.length, presetDimensions.length, presetDimensions.body_diameter);
      assert(presetDimensions.collar_diameter > presetDimensions.shank_diameter);
      assert(presetDimensions.shank_diameter > presetDimensions.body_diameter);
    } finally { releaseBodies(presetBodies); }
    assert.throws(() => insertRefill(bolt, kind, sleeveDonor, {replaceBodyId:"bolt-refill"}),
      /bolt|fixed/i, "do not install the press-in nose as a retractable refill");
    const separate = insertRefill(bolt, kind, sleeveDonor);
    assert.notEqual(separate.bodyId, "bolt-refill");
    assert.equal(refillComponents(separate.project).length, 2);
    const {project: mounted, bodyId} = insertRefill(start, kind, sleeveDonor);
    for (const reversed of [false, true]) {
      const saved = validateProject(JSON.parse(JSON.stringify(reversed ? reverseRefill(mounted, bodyId) : mounted)));
      const {features} = await evaluateModel(saved);
      // Each ring acts as a gauge at a known physical station on the axial profile.
      const gauge = (id, from, to, bore) => {
        const a = reversed ? 130 - to : from, b = reversed ? 130 - from : to;
        return { id, name:id, kind:"revolve", operation:"new", amount:360,
          points:[[a,bore/2],[a,5],[b,5],[b,bore/2]] };
      };
      const gauges = [
        gauge("nib", 2.5, 3.5, 2.2), gauge("seat", 11.4, 11.9, 7.6),
        gauge("socket", 12, 20, 6.5), gauge("chamber", 20, 38, 4),
      ];
      const solids = buildBodies([...features, ...gauges]);
      const ids = [bodyId, ...gauges.map(g => g.id)];
      try {
        checkEnds(solids[0].shape, 130, reversed ? 0 : 130, 3);
        const fit = shape => {
          const lands = solids.map((s,i) => collectFitSurfaces(i === 0 ? shape : s.shape, ids[i], true));
          const checks = refillBoreChecks(bodyId, ids, lands, ids.map(() => identity));
          const clearance = id => checks.find(c => c.bodyId === id)?.clearance;
          near(clearance("nib"), 2.2 - 2 * 3.5 / 4); // Metal point tapers up to its plastic nose.
          near(clearance("seat"), 0.1);
          near(clearance("socket"), -0.3);
          near(clearance("chamber"), 1);
        };
        fit(solids[0].shape);
        if (kind === "bic-round-stic" && reversed) {
          const imported = await importSolidFile("step", exportBodies([solids[0]], "step"), "Stic donor");
          try { fit(imported[0].shape); }
          finally { releaseBodies(imported); }
        }
      } finally { releaseBodies(solids); }
    }
    assert.throws(() => insertRefill(start, kind, { ...sleeveDonor, shank_length:"125 mm" }),
      Error, "the measured seat and shank must leave length for the tube");
    assert.throws(() => insertRefill(start, kind, { ...sleeveDonor, seat_distance:"2 mm" }),
      Error, "the writing point and exposed nib must precede the seat");
  }
  for (const [kind, overrides] of [
    ["energel-lr7", {}],
    ["bic-cristal", donor],
  ]) {
    const p = insertRefill(bolt, kind, overrides, {
      replaceBodyId: "bolt-refill",
    }).project;
    const evaluated = await evaluateModel(p);
    const bodies = buildBodies(evaluated.features);
    try {
      assert.equal(
        bodies.length,
        p.features.filter((f) => f.operation === "new").length,
      );
      assert.equal(p.workspaces.joints["bolt-refill"].parent, "bolt-carrier");
      near(
        evaluated.values.tip_bore,
        evaluated.values.refill_guide_diameter +
          evaluated.values.guide_clearance,
      );
    } finally {
      releaseBodies(bodies);
    }
  }
  for (const diameter of ["2.54 mm", "3 mm"]) {
    const p = {
      ...project,
      parameters: project.parameters.map((parameter) =>
        parameter.name === "refill_neck_diameter"
          ? { ...parameter, expression: diameter }
          : parameter,
      ),
    };
    const rebuilt = buildBodies((await evaluateModel(p)).features);
    releaseBodies(rebuilt);
  }
  console.log(
    "Passed cartridge profiles, preserved bare Cristal, both complete BIC donor seats and socket fits, reversal, parametric swaps, posed joints, STEP and STL.",
  );
} finally {
  await server.close();
}
