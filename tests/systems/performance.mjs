import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Solid } from "replicad";
import {
  runtime,
  boxSketch,
  feature,
  project,
  near,
  save,
} from "./runtime.mjs";
const api = await runtime();
const { ModelBodies } = await api.load("modelBodies"),
  { evaluateModel } = await api.load("buildModel");
const { buildPoses, defaultJoint } = await api.load("kinematics");
const samples = [];
async function time(name, budgetMs, fn, common = false) {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  samples.push({
    name,
    ms,
    budgetMs,
    exceedsBudget: ms > budgetMs,
    common,
    above500ms: ms > 500,
  });
  console.log(name, ms.toFixed(2) + " ms", "budget", budgetMs + " ms");
  return result;
}
async function build(project, cache, keys = []) {
  const evaluated = await evaluateModel(project);
  return cache.build(evaluated.features, keys);
}
try {
  const cache = new ModelBodies();
  try {
    const pen = JSON.parse(
      await readFile("examples/twist-pen.turnmill", "utf8"),
    );
    const cold = await time(
      "Cold four-part twist pen, evaluation, exact solids and display meshes",
      90000,
      () => build(pen, cache),
    );
    assert.equal(cold.keys.length, 4);
    const refill = pen.parameters.find((p) => p.name === "refill_diameter");
    assert(refill);
    refill.expression = "5.75 mm";
    const warm = await time(
      "Warm refill-only edit, four-part pen",
      500,
      () => build(pen, cache, cold.keys),
      true,
    );
    assert.equal(warm.changes.length, 1);
  } finally {
    cache.clear();
  }
  const history = Array.from({ length: 100 }, (_, i) => {
    const sketch = boxSketch("sk" + i, 1.5 * i, 0, 1.5 * i + 2, 1);
    const op = {
      ...feature("f" + i, sketch.id, 1),
      operation: i ? "add" : "new",
      ...(i ? { bodyId: "f0" } : {}),
    };
    return { sketch, op };
  });
  const single = project(
    history.map((v) => v.sketch),
    history.map((v) => v.op),
  );
  const long = new ModelBodies();
  // Observe the actual boolean calls in the production kernel path. Restore the
  // method before leaving the fixture, including when geometry validation fails.
  const solidMethods = Object.getPrototypeOf(Solid.prototype);
  const originalFuse = solidMethods.fuse;
  let fuses = 0;
  solidMethods.fuse = function (...args) {
    fuses++;
    return Reflect.apply(originalFuse, this, args);
  };
  const replay = { coldFuses: 0, unchangedFuses: 0, editedFuses: [] };
  try {
    const cold = await time("Cold 100-feature history, one solid", 60000, () =>
      build(single, long),
    );
    replay.coldFuses = fuses;
    fuses = 0;
    const unchanged = await build(single, long, cold.keys);
    near(unchanged.volume, cold.volume, 1e-7, "unchanged cache control");
    replay.unchangedFuses = fuses;
    near(cold.volume, 150.5, 0.1505, "100-feature solid");
    await save("SYS-003/100-feature-history.turnmill", single);
    let last = cold;
    const durations = [];
    for (const depth of [0.75, 0.5, 0.625]) {
      fuses = 0;
      single.features.at(-1).amount = String(depth);
      const edit = await time(
        "Edit final additive feature to " + depth + " mm in 100-feature solid",
        500,
        () => build(single, long, last.keys),
        true,
      );
      near(edit.volume, 149 + 1.5 * depth, 0.15, "last feature edit");
      samples.at(-1).scope = "Native diagnostic for an end-to-end budget";
      replay.editedFuses.push(fuses);
      samples.at(-1).booleanFuses = fuses;
      durations.push(samples.at(-1).ms);
      last = edit;
    }
    const sorted = [...durations].sort((a, b) => a - b);
    await save("SYS-003/timings.json", {
      units: "ms",
      durations,
      median: sorted[1],
      interactiveBudget: 500,
    });
    assert.equal(
      replay.coldFuses,
      99,
      "Observer failed to count the 99 unions in the initial build",
    );
    assert.equal(replay.unchangedFuses, 0);
    assert.deepEqual(
      replay.editedFuses,
      [1, 1, 1],
      "Tail edits need only the changed union",
    );
    await save("SYS-003/boolean-work.json", replay);
    console.log(
      "Native diagnostic:",
      sorted[1].toFixed(2),
      "ms median; boolean fuses",
      JSON.stringify(replay),
    );
  } finally {
    solidMethods.fuse = originalFuse;
    long.clear();
  }
  const many = Array.from({ length: 50 }, (_, i) => ({
    sketch: boxSketch("s" + i, 0, 0, 2, 3),
    f: feature("p" + i, "s" + i, 4),
  }));
  const multi = project(
      many.map((x) => x.sketch),
      many.map((x) => x.f),
    ),
    big = new ModelBodies();
  try {
    const lower = await time("Cold 50-part assembly geometry", 15000, () =>
      build(multi, big),
    );
    assert.equal(lower.keys.length, 50);
    near(lower.volume, 1200, 1.2, "50 bodies volume");
    const ids = many.map((x) => x.f.id);
    const config = Object.fromEntries(
      ids.map((id, i) => [
        id,
        {
          ...defaultJoint(),
          parent: ids[i - 1] || "",
          offset: [i ? "3 mm" : "0", "0", "0"],
        },
      ]),
    );
    const poses = await time(
      "50-component parent chain, one pose",
      500,
      () => buildPoses(ids, config, {}, {}),
      true,
    );
    near(poses.at(-1)[12], 147, 0.01, "50-component placement");
  } finally {
    big.clear();
  }
  const missed = samples.filter(
    (t) =>
      t.exceedsBudget &&
      t.scope !== "Native diagnostic for an end-to-end budget",
  );
  if (missed.length)
    throw Error(
      "Exceeded runtime budgets: " + missed.map((t) => t.name).join(", "),
    );
} finally {
  await save("performance.json", {
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    scope:
      "Native worker path, excludes browser paint. 500 ms interactive target also recorded for all declared common actions.",
    samples,
  });
  await api.close();
}
