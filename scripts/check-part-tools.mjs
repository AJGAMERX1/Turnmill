import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { getOC, setOC } from "replicad";

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});

function rectangle(id, left, bottom, right, top) {
  return {
    id,
    name: id,
    constraints: [],
    points: [
      [left, bottom],
      [right, bottom],
      [right, top],
      [left, top],
    ].map(([x, y]) => ({ x: String(x), y: String(y) })),
  };
}

function newSolid(id, sketchId, amount, kind = "extrude") {
  return {
    id,
    name: id,
    sketchId,
    amount,
    kind,
    operation: "new",
    suppressed: false,
  };
}

function withOperation(feature, operation) {
  return {
    ...feature,
    operations: [
      { id: "operation", name: operation.kind, suppressed: false, operation },
    ],
  };
}

function near(actual, expected, label, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    label + ": expected " + expected + ", got " + actual,
  );
}

try {
  const wasmBinary = await readFile(
    new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
  );
  setOC(await initOC({ wasmBinary }));
  const { evaluateModel } = await server.ssrLoadModule("/src/buildModel.ts");
  const { buildBodies, displayBodies, releaseBodies } =
    await server.ssrLoadModule("/src/geometry.ts");
  const { materials, parseDensity, massProperties } =
    await server.ssrLoadModule("/src/materials.ts");
  const plate = newSolid("Plate", "plate", "height");
  const blank = newSolid("Turning", "outer", "360 deg", "revolve");
  const coupon = newSolid("Coupon", "offset-square", "height / 2");
  const source = {
    version: 1,
    id: "part-tools",
    name: "Part tool checks",
    parameters: [
      { name: "height", expression: "8 mm" },
      { name: "wall", expression: "height / 8" },
    ],
    sketches: [
      rectangle("plate", 0, 0, 20, 12),
      rectangle("pocket", 3, 2, 7, 8),
      rectangle("outer", 0, 0, 24, 5),
      rectangle("bore", 0, 0, 8, 2),
      rectangle("offset-square", 6, 3, 8, 5),
      rectangle("section", -1, -1, 1, 1),
      rectangle("path", 0, 6, 20, 9),
      rectangle("lower", 4, 4, 8, 8),
      rectangle("upper", 5, 5, 7, 7),
    ],
  };

  async function inspect(features, check, parameters = source.parameters) {
    // Drive the exact same expressions, sketch solving, and operation stack as an edited project.
    const model = await evaluateModel({ ...source, parameters, features });
    const bodies = buildBodies(model.features);
    try {
      for (const { shape } of bodies) {
        const checker = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true);
        try {
          assert.ok(checker.IsValid(), "OpenCascade reported an invalid B-rep");
        } finally {
          checker.delete();
        }
      }
      check(displayBodies(bodies), bodies, model.values);
    } finally {
      releaseBodies(bodies);
    }
  }

  async function verify(
    label,
    features,
    expected,
    solids = 1,
    center,
    parameters,
  ) {
    await inspect(
      features,
      (metrics, bodies) => {
        near(metrics.volume, expected, label + " volume");
        if (center)
          center.forEach((v, i) =>
            near(metrics.center[i], v, label + " center " + i),
          );
        let total = 0;
        for (const { shape } of bodies) {
          const items = shape.solids;
          total += items.length;
          items.forEach((item) => item.delete());
        }
        assert.equal(total, solids, label + " connected solids");
      },
      parameters,
    );
  }

  const { validateProject } = await server.ssrLoadModule("/src/projects.ts");
  const { insertHardware } = await server.ssrLoadModule("/src/hardware.ts");
  const { projectPartTabs, partFeatures, partSketches, savePartFeature, organizePartInsertion } =
    await server.ssrLoadModule("/src/partTabs.ts");
  const blockVolume = 20 * 12 * 8;
  const pocket = {
    ...newSolid("Pocket", "pocket", "height / 2"),
    operation: "cut",
    bodyId: plate.id,
  };
  await verify("Extrude cut", [plate, pocket], blockVolume - 4 * 6 * 4);
  // A feature added to the first of two open parts must still machine the first body.
  const tab = { id: "reserved-id", name: "Coupon blank" };
  const multi = { ...source, emptyParts: [tab], features: [plate, blank] };
  assert.deepEqual(projectPartTabs(validateProject(JSON.parse(JSON.stringify(multi)))).map((p) => p.id),
    [plate.id, blank.id, tab.id]);
  const cutFirst = savePartFeature(multi, plate, { ...pocket, bodyId: undefined });
  assert.deepEqual(cutFirst.features.map((f) => f.id), [plate.id, pocket.id, blank.id]);
  assert.deepEqual(partFeatures(cutFirst, plate.id).map((f) => f.id), [plate.id, pocket.id]);
  assert.deepEqual(partSketches(cutFirst, plate.id, partFeatures(cutFirst, plate.id)).map((s) => s.id), ["plate", "pocket"]);
  await verify("Isolated first part cut survives assembly rebuild", cutFirst.features,
    blockVolume - 4 * 6 * 4 + Math.PI * 25 * 24, 2);
  const freshSketch = rectangle("coupon-tab-sketch", 0, 0, 1, 2);
  const modeled = savePartFeature(cutFirst, tab, newSolid("temporary", freshSketch.id, "5"), freshSketch);
  assert.equal(modeled.features.at(-1).id, tab.id);
  assert.equal(modeled.sketches.at(-1).partId, tab.id);
  assert.deepEqual(modeled.emptyParts, []);
  assert.doesNotThrow(() => validateProject(JSON.parse(JSON.stringify(modeled))));
  const hardware = organizePartInsertion(multi, insertHardware(multi, "screw", 1, "12 mm", "cosmetic"), tab);
  const [shank, head] = partFeatures(hardware, tab.id);
  assert.equal(shank.name, tab.name);
  assert.equal(head.bodyId, tab.id);
  assert.equal(hardware.workspaces.bodyMaterials[tab.id], "Steel");
  assert.ok(hardware.workspaces.hardwareComponents[tab.id].dimensions.length > 0);
  assert.deepEqual(hardware.emptyParts, []);
  assert.throws(() => validateProject({ ...multi, emptyParts: [{ ...tab, id: plate.id }] }), /unique ID/);
  console.log("PASS linked part tabs, scoped cuts against two B-rep bodies, pending tab save/load, and catalog fastener ownership.");
  const latheBore = {
    ...newSolid("Bore", "bore", "360 deg", "revolve"),
    operation: "cut",
    bodyId: blank.id,
  };
  await verify("Revolve cut", [blank, latheBore], Math.PI * (25 * 24 - 4 * 8));
  const shell = withOperation(plate, {
    kind: "shell",
    face: "zMax",
    thickness: "wall",
  });
  await verify("Inward shell", [shell], blockVolume - 18 * 10 * 7);
  await verify(
    "Shell after dimension change",
    [shell],
    20 * 12 * 12 - 17 * 9 * 10.5,
    1,
    undefined,
    [
      { name: "height", expression: "12 mm" },
      { name: "wall", expression: "height / 8" },
    ],
  );

  await verify(
    "Linear pattern",
    [
      withOperation(coupon, {
        kind: "linearPattern",
        axis: "X",
        count: "2 + 1",
        spacing: "height",
      }),
    ],
    48,
    3,
    [15, 4, 2],
  );
  await verify(
    "Touching linear copies fuse",
    [
      withOperation(coupon, {
        kind: "linearPattern",
        axis: "Y",
        count: "3",
        spacing: "2 mm",
      }),
    ],
    48,
    1,
    [7, 6, 2],
  );
  await verify(
    "Circular pattern",
    [
      withOperation(coupon, {
        kind: "circularPattern",
        axis: "Z",
        count: "4",
        stepAngle: "360 deg / 4",
      }),
    ],
    64,
    4,
    [0, 0, 2],
  );
  await verify(
    "Mirror only",
    [
      withOperation(coupon, {
        kind: "mirror",
        plane: "YZ",
        offset: "height / 4",
        keepOriginal: false,
      }),
    ],
    16,
    1,
    [-3, 4, 2],
  );
  await verify(
    "Mirror and retain original",
    [
      withOperation(coupon, {
        kind: "mirror",
        plane: "YZ",
        offset: "height / 4",
        keepOriginal: true,
      }),
    ],
    32,
    2,
    [2, 4, 2],
  );

  const sweep = {
    kind: "sweep",
    sectionId: "section",
    pathId: "path",
    firstVertex: 0,
    lastVertex: 1,
    direction: "forward",
    anchorX: "0",
    anchorY: "0",
    z: "height / 2",
    mode: "replace",
  };
  await verify(
    "Sweep",
    [withOperation(plate, sweep)],
    20 * 2 * 2,
    1,
    [10, 6, 4],
  );
  await verify(
    "Swept cut",
    [withOperation(plate, { ...sweep, mode: "cut" })],
    blockVolume - 20 * 2 * 2,
  );
  const loft = {
    kind: "loft",
    lowerId: "lower",
    upperId: "upper",
    z1: "0",
    z2: "height",
    mode: "replace",
  };
  const frustum = (8 * (16 + 8 + 4)) / 3;
  await verify("Two-section ruled loft", [withOperation(plate, loft)], frustum);
  await verify(
    "Lofted cut",
    [withOperation(plate, { ...loft, mode: "cut" })],
    blockVolume - frustum,
  );
  await assert.rejects(
    verify(
      "Repeated circular copy",
      [
        withOperation(coupon, {
          kind: "circularPattern",
          axis: "Z",
          count: "5",
          stepAngle: "90 deg",
        }),
      ],
      0,
    ),
    /coincides/,
  );
  await assert.rejects(
    verify(
      "Zero-height loft",
      [withOperation(plate, { ...loft, z2: "0 mm" })],
      0,
    ),
    /different Z heights/,
  );

  await inspect([plate, coupon], (metrics, _, values) => {
    const densities = [
      materials.Brass.density,
      parseDensity("2700 kg/m^3", values),
    ];
    near(densities[1], materials.Aluminum.density, "Density conversion");
    near(
      parseDensity("0.0085 g/mm³", values),
      materials.Brass.density,
      "Alternate density units",
    );
    assert.throws(() => parseDensity("-1 g/cm³", values), /positive density/);
    const expectedMasses = [(blockVolume * 8.5) / 1000, (16 * 2.7) / 1000];
    const mass = expectedMasses[0] + expectedMasses[1];
    const centers = [
      [10, 6, 4],
      [7, 4, 2],
    ];
    const measured = massProperties(metrics.bodyProperties, densities);
    near(measured.mass, mass, "Combined mass in grams");
    for (let i = 0; i < 3; i++)
      near(
        measured.center[i],
        (expectedMasses[0] * centers[0][i] +
          expectedMasses[1] * centers[1][i]) /
          mass,
        "Mixed-material balance " + i,
      );
    const selected = massProperties(
      [metrics.bodyProperties[1]],
      [densities[1]],
    );
    near(selected.mass, expectedMasses[1], "Selected part mass");
    selected.center.forEach((v, i) =>
      near(v, centers[1][i], "Selected part balance " + i),
    );
  });
  console.log(
    "Passed extrude/revolve cuts, shell walls, linear and circular patterns, mirrors, swept and lofted solids and cuts, and mixed-material mass and balance.",
  );
} finally {
  await server.close();
}
