import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { BufferGeometry } from "three";

const solver = "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  plugins: [
    {
      name: "fixture-solver",
      enforce: "pre",
      resolveId(id) {
        if (id === solver + "?url") return "virtual:fixture-solver";
      },
      load(id) {
        if (id === "virtual:fixture-solver")
          return (
            "export default " +
            JSON.stringify(fileURLToPath(import.meta.resolve(solver)))
          );
      },
    },
  ],
});
setOC(
  await initOC({
    wasmBinary: await readFile(
      new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
    ),
  }),
);
const { ModelBodies } = await server.ssrLoadModule("/src/modelBodies.ts");
const { buildBodies, displayBodies, exportBodies, releaseBodies } =
  await server.ssrLoadModule("/src/geometry.ts");
const model = new ModelBodies();
const near = (actual, expected, epsilon = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    actual + " versus " + expected,
  );
try {
  const plate = {
    id: "plate",
    name: "Stock",
    kind: "extrude",
    operation: "new",
    points: [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ],
    amount: 5,
  };
  const tube = {
    id: "tube",
    name: "Tube",
    kind: "revolve",
    operation: "new",
    points: [
      [0, 2],
      [0, 3],
      [12, 3],
      [12, 2],
    ],
    amount: 360,
  };
  const bore = {
    id: "cut",
    name: "Pocket",
    kind: "extrude",
    operation: "cut",
    points: [
      [2, 2],
      [4, 2],
      [4, 4],
      [2, 4],
    ],
    amount: 3,
  };
  // A preview belongs to one complete evaluated body history. Check its use and
  // rejection independently of timing, including retained stock before its last cut.
  const preview = new ModelBodies();
  const committed = new ModelBodies();
  try {
    const history = [plate, bore];
    const checked = preview.build(history);
    const brep = preview.bodies[0].shape.serialize();
    let reads = 0;
    const snapshot = {
      bodyId: plate.id,
      history: JSON.stringify(history),
      get brep() {
        reads++;
        return brep;
      },
      volume: checked.volume,
    };
    const installed = committed.build([...history, tube], [], snapshot);
    assert.equal(reads, 1);
    near(installed.bodyProperties[0].volume, checked.volume);
    for (const field of ["vertices", "normals", "triangles", "edges"]) {
      assert.deepEqual(
        installed.changes[0].mesh[field],
        checked.changes[0].mesh[field],
      );
    }
    const edited = [plate, { ...bore, amount: 4 }, tube];
    const changed = committed.build(edited, installed.keys, snapshot);
    assert.equal(reads, 1);
    near(changed.bodyProperties[0].volume, 984);
    const unreadable = { ...snapshot, brep: "" };
    const fallback = committed.build(
      [...history, tube],
      changed.keys,
      unreadable,
    );
    near(fallback.bodyProperties[0].volume, checked.volume);
    assert.throws(
      () =>
        committed.build(
          [plate, { ...bore, amount: 0 }],
          fallback.keys,
          snapshot,
        ),
      /nonzero/,
    );
    const undo = committed.build([plate, tube], fallback.keys);
    near(undo.bodyProperties[0].volume, 1000);
    const redo = committed.build([...history, tube], undo.keys);
    near(redo.bodyProperties[0].volume, checked.volume);
    const reorder = committed.build([tube, ...history], redo.keys);
    assert.deepEqual(reorder.keys, [redo.keys[1], redo.keys[0]]);
    assert.equal(reorder.changes.length, 0);
  } finally {
    preview.clear();
    committed.clear();
  }

  // Headless validation builds exact, unmeshed B-reps. The viewport can take
  // both changed bodies, while independently rejecting a stale one on edit.
  const headless = new ModelBodies(), viewport = new ModelBodies();
  try {
    const history = [plate, bore, tube];
    const checked = headless.build(history, [], undefined, false);
    assert.equal(checked.changes.length, 0);
    const snapshots = headless.snapshots([tube.id, plate.id, tube.id, "missing"]);
    assert.deepEqual(snapshots.map(s => s.bodyId), [tube.id, plate.id]);
    const reads = new Set();
    const tracked = snapshots.map(s => ({ ...s, get brep() { reads.add(s.bodyId); return s.brep; } }));
    const installed = viewport.build(history, [], tracked);
    assert.deepEqual(reads, new Set([plate.id, tube.id]));
    assert.equal(installed.changes.length, 2);
    assert.equal(installed.bodyProperties.length, checked.bodyProperties.length);
    installed.bodyProperties.forEach((body, i) => {
      const expected = checked.bodyProperties[i];
      near(body.volume, expected.volume, 1e-10);
      body.center.forEach((coordinate, axis) => near(coordinate, expected.center[axis], 1e-10));
    });
    near(installed.area, checked.area);
    viewport.clear();
    reads.clear();
    const amended = viewport.build([plate, { ...bore, amount: 4 }, tube], [], tracked);
    assert.deepEqual(reads, new Set([tube.id]));
    near(amended.bodyProperties[0].volume, 984);
    const redisplay = headless.build(history);
    assert.equal(redisplay.changes.length, 2);
    assert.deepEqual(redisplay.keys, checked.keys);
  } finally {
    headless.clear();
    viewport.clear();
  }

  const a = model.build([plate, bore, tube]);
  assert.equal(a.changes.length, 2);
  const [plateKey, tubeKey] = a.keys;
  const ref = model.bodies[1].shape;
  const updated = [{ ...tube, name: "Spindle" }, plate, { ...bore, amount: 4 }];
  const b = model.build(updated, a.keys);
  assert.deepEqual(b.keys, [tubeKey, b.changes[0].key]);
  assert.notEqual(b.keys[1], plateKey);
  assert.equal(b.changes.length, 1);
  assert.equal(model.bodies[0].shape, ref);
  assert.equal(model.bodies[0].name, "Spindle");
  const full = buildBodies(updated);
  try {
    const expected = displayBodies(full);
    near(b.volume, expected.volume);
    near(b.area, expected.area);
    assert.deepEqual(b.bodyProperties, expected.bodyProperties);
    assert.deepEqual(b.center, expected.center);
    const edited = b.changes[0].mesh;
    for (const key of ["vertices", "normals", "triangles", "edges"])
      assert.deepEqual(edited[key], expected.meshes[1][key]);
  } finally {
    releaseBodies(full);
  }
  // A main thread which dropped an obsolete worker response requests its missing mesh again.
  const resent = model.build(updated, [tubeKey]);
  assert.deepEqual(resent.keys, b.keys);
  assert.deepEqual(
    resent.changes.map((c) => c.key),
    [b.keys[1]],
  );
  assert.equal(model.build(updated, b.keys).changes.length, 0);
  assert.throws(
    () => model.build([tube, plate, { ...bore, amount: 0 }], b.keys),
    /nonzero/,
  );
  assert.throws(() => model.build([bore], b.keys), /New body/);
  assert.deepEqual(model.build(updated, b.keys).keys, b.keys);
  const noPlate = model.build([tube], b.keys);
  assert.deepEqual(noPlate.keys, [tubeKey]);
  const restored = model.build(updated, noPlate.keys);
  assert.equal(restored.changes.length, 1);
  const { importSolidFile } = await server.ssrLoadModule(
    "/src/exchangeSolids.ts",
  );
  const step = exportBodies(model.bodies, "step");
  assert.match(await step.text(), /Spindle/);
  const reopened = await importSolidFile("step", step, "Check");
  try {
    assert.deepEqual(
      reopened.map((body) => body.name),
      ["Spindle", "Stock"],
    );
    near(
      reopened.reduce((s, p) => s + measureVolume(p.shape), 0),
      b.volume,
    );
  } finally {
    releaseBodies(reopened);
  }
  // File entity order is independent of assembly order. Also exercise Part 21's
  // quoted apostrophe and Unicode escapes in the actual product name.
  const plain = await step.text();
  const spindle = plain.match(/#\d+\s*=\s*PRODUCT\('Spindle'[^;]*;/)?.[0];
  const stock = plain.match(/#\d+\s*=\s*PRODUCT\('Stock'[^;]*;/)?.[0];
  assert.ok(spindle && stock, "Both product definitions must be present");
  const namedStock = stock.replace(
    "'Stock','Stock'",
    String.raw`'Stock','Maker''s \X2\00D8\X0\'`,
  );
  const reorderedSteps = plain
    .replace(spindle, "#QA_TEMP")
    .replace(stock, spindle)
    .replace("#QA_TEMP", namedStock);
  const renamed = await importSolidFile(
    "step",
    new Blob([reorderedSteps]),
    "fallback",
  );
  try {
    assert.deepEqual(
      renamed.map((body) => body.name),
      ["Spindle", "Maker's Ø"],
    );
    near(
      measureVolume(renamed[1].shape),
      model.bodies.map((b) => measureVolume(b.shape))[1],
    );
  } finally {
    releaseBodies(renamed);
  }
  const importFeature = {
    ...tube,
    id: "import",
    kind: "import",
    brep: model.bodies[0].shape.serialize(),
  };
  const imported = model.build([importFeature, plate]);
  const changed = model.build(
    [{ ...importFeature, brep: model.bodies[1].shape.serialize() }, plate],
    imported.keys,
  );
  near(changed.bodyProperties[0].volume, 1000);
  assert.equal(changed.changes.length, 1);
  model.clear();
  const { setFaceHighlights } = await server.ssrLoadModule("/src/studio.ts");
  const geo = new BufferGeometry();
  geo.setIndex(Array.from({ length: 24 }, (_, i) => i));
  const faces = [
    { start: 0, count: 3 },
    { start: 3, count: 9 },
    { start: 12, count: 6 },
    { start: 18, count: 6 },
  ];
  for (const [hover, selected] of [
    [-1, -1],
    [0, -1],
    [0, 0],
    [1, 3],
    [3, 1],
    [-1, 2],
  ]) {
    setFaceHighlights(geo, faces, hover, selected);
    const restored = geo.groups.flatMap((g) =>
      Array(g.count).fill(g.materialIndex),
    );
    const expected = faces.flatMap((f, i) =>
      Array(f.count).fill(i === selected ? 2 : i === hover ? 1 : 0),
    );
    assert.deepEqual(restored, expected);
    assert.ok(geo.groups.length <= 5);
  }
  geo.dispose();
  console.log(
    "Passed body reuse, name and order changes, dependent cuts, stale mesh recovery, failed rebuilds, suppression, embedded imports, STEP round-trip and highlighted face ranges.",
  );

  if (process.argv.includes("--pen")) {
    const { evaluateModel } = await server.ssrLoadModule("/src/buildModel.ts");
    const p = JSON.parse(
      await readFile(
        new URL("../examples/twist-pen.turnmill", import.meta.url),
        "utf8",
      ),
    );
    const { features: original } = await evaluateModel(p);
    const initial = model.build(original);
    p.parameters.find((p) => p.name === "refill_diameter").expression =
      "5.5 mm";
    const { features: edited } = await evaluateModel(p);
    const start = performance.now();
    const incremental = model.build(edited, initial.keys);
    const cachedMs = performance.now() - start;
    const cold = performance.now(),
      reference = buildBodies(edited);
    try {
      const result = displayBodies(reference);
      const fullMs = performance.now() - cold;
      near(incremental.volume, result.volume);
      near(incremental.area, result.area);
      assert.deepEqual(incremental.bodyProperties, result.bodyProperties);
      assert.deepEqual(incremental.center, result.center);
      const changedIds = incremental.keys.flatMap((key, i) =>
        initial.keys[i] === key ? [] : [edited[i].id],
      );
      assert.deepEqual(changedIds, ["pen-refill"]);
      assert.deepEqual(
        model.bodies.flatMap((b) => b.threadFrames || []),
        reference.flatMap((b) => b.threadFrames || []),
      );
      const all = await importSolidFile(
        "step",
        exportBodies(model.bodies, "step"),
        "Twist pen",
      );
      try {
        assert.equal(all.length, 4);
        const volumes = all
          .map((b) => measureVolume(b.shape))
          .sort((a, b) => a - b);
        const exact = reference
          .map((b) => measureVolume(b.shape))
          .sort((a, b) => a - b);
        volumes.forEach((v, i) => near(v, exact[i], 0.003));
      } finally {
        releaseBodies(all);
      }
      console.log(
        `Modeled twist pen: refill edit rebuilt 1/4 bodies in ${cachedMs.toFixed(1)} ms; complete reference ${fullMs.toFixed(1)} ms. All four STEP solids and thread frames verified.`,
      );
    } finally {
      releaseBodies(reference);
    }
  }
} finally {
  model.clear();
  await server.close();
}
