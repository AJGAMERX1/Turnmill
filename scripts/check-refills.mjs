import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { setOC } from "replicad";

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
  const { insertRefill, refillComponents, refillDimensions, refillMassGrams } =
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
    "Passed three native refill profiles, source dimensions, donor validation, parametric swaps, posed joints, STEP and STL.",
  );
} finally {
  await server.close();
}
