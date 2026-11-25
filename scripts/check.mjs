import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { setOC } from "replicad";
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { evaluate, resolveParameters } = await server.ssrLoadModule(
    "/src/expressions.ts",
  );
  const values = resolveParameters([
    { name: "width", expression: "1/2 in" },
    { name: "length", expression: "width*4" },
    { name: "half", expression: "length/2 + 3" },
  ]);
  assert.equal(values.width, 12.7);
  assert.equal(values.half, 28.4);
  assert.equal(evaluate("1/32 in", values), 0.79375);
  assert.equal(evaluate("90 deg + 90", values, "angle"), 180);
  assert.throws(() => evaluate("3 mm + 3 deg", values));
  assert.throws(() =>
    resolveParameters([
      { name: "a", expression: "b" },
      { name: "b", expression: "a" },
    ]),
  );
  const { defaultJoint, buildPoses } =
    await server.ssrLoadModule("/src/kinematics.ts");
  const lead = {
    ...defaultJoint(),
    parent: "barrel",
    kind: "screw",
    min: "0",
    max: "720 deg",
    pitch: "0.75 mm",
    starts: "2",
  };
  const clip = { ...defaultJoint(), parent: "cap", offset: ["0", "2", "0"] };
  const matrices = buildPoses(
    ["barrel", "cap", "clip"],
    { cap: lead, clip },
    { cap: [360] },
    values,
  );
  assert.equal(matrices[1][12], 1.5);
  assert.equal(matrices[2][12], 1.5);
  assert.ok(Math.abs(matrices[2][13] - 2) < 1e-8);
  assert.throws(() =>
    buildPoses(
      ["a", "b"],
      { a: { ...clip, parent: "b" }, b: { ...clip, parent: "a" } },
      {},
      values,
    ),
  );
  const wasm = await readFile(
    new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
  );
  setOC(await initOC({ wasmBinary: wasm }));
  const { buildBodies, displayBodies, releaseBodies, exportBodies } =
    await server.ssrLoadModule("/src/geometry.ts");
  const base = {
    id: "tube",
    name: "Test tube",
    kind: "revolve",
    operation: "new",
    amount: 360,
    points: [
      [0, 2],
      [0, 6],
      [92, 6],
      [92, 2],
    ],
  };
  const solids = buildBodies([base]);
  try {
    const metrics = displayBodies(solids);
    assert.ok(Math.abs(metrics.volume - Math.PI * 32 * 92) < 1e-5);
    assert.ok(Math.abs(metrics.center[0] - 46) < 1e-5);
    assert.match(await exportBodies(solids, "step").text(), /ISO-10303-21/);
    assert.ok(exportBodies(solids, "stl").size > 84);
    assert.equal(
      new Uint8Array(await exportBodies(solids, "3mf").arrayBuffer())[0],
      80,
    );
  } finally {
    releaseBodies(solids);
  }
  console.log(
    "Passed unit math, dependency errors, screw lead, joint parenting, exact tube mass properties, and STEP/STL/3MF export.",
  );
} finally {
  await server.close();
}
