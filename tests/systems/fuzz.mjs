import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import {
  runtime,
  project,
  boxSketch,
  feature,
  geometry,
  near,
  save,
} from "./runtime.mjs";
const api = await runtime();
const { evaluateModel } = await api.load("buildModel");
const { buildBodies, releaseBodies } = await api.load("geometry"),
  { openJournal } = await api.load("journalStore");
const { validateProject } = await api.load("projects");
const seed = Number(process.env.QA_SEED ?? 0x20261125) >>> 0;
const seconds = Number(process.env.QA_FUZZ_MS ?? 35000) / 1000,
  cap = Number(process.env.QA_FUZZ_CHAINS ?? 1000000);
if (
  !(Number.isFinite(seconds) && seconds > 0 && Number.isInteger(cap) && cap > 0)
)
  throw Error("Use positive QA_FUZZ_MS and QA_FUZZ_CHAINS.");
const rand = (s) => () => {
  s = (Math.imul(1664525, s) + 1013904223) >>> 0;
  return s;
};
const kinds = [
  "dimension",
  "add",
  "suppress",
  "edit profile",
  "rename",
  "move earlier",
  "delete",
  "undo",
  "redo",
  "file roundtrip",
  "autosave reload",
  "drawing note",
  "change sketch kind",
];
function generate(s, n) {
  const r = rand(s);
  return Array.from({ length: n }, (_, i) => ({
    type: kinds[r() % kinds.length],
    n: (r() % 500) + 1,
    id: "added-" + i,
  }));
}
const initial = () =>
  project(
    [boxSketch("profile-first", 0, 0, 3, 5)],
    [feature("first", "profile-first", "depth")],
    { parameters: [{ name: "depth", expression: "2 mm" }] },
  );
function apply(p, a) {
  const q = structuredClone(p);
  const n = q.features.length;
  const idx = n ? a.n % n : 0,
    f = q.features[idx];
  const sk = f ? q.sketches.find((s) => s.id === f.sketchId) : undefined;
  const label = "QA " + a.n + " ✏️";
  switch (a.type) {
    case "dimension":
      q.parameters[0].expression = 1 + (a.n % 14) + " mm";
      break;
    case "add": {
      if (n >= 5) return p;
      const id = a.id,
        k = "profile-" + id;
      q.sketches.push(boxSketch(k, 0, 0, 1 + (a.n % 19), 2 + (a.n % 8)));
      q.features.push(feature(id, k, "depth"));
      break;
    }
    case "edit profile":
      if (!sk) return p;
      sk.points[1].x = sk.points[2].x = String(1 + (a.n % 22));
      break;
    case "suppress":
      if (!f) return p;
      f.suppressed = !f.suppressed;
      break;
    case "rename":
      if (!f) return p;
      f.name = label;
      break;
    case "delete":
      if (!f) return p;
      q.features.splice(idx, 1);
      q.sketches = q.sketches.filter((s) => s.id !== f.sketchId);
      break;
    case "move earlier":
      if (!f || idx === 0) return p;
      [q.features[idx - 1], q.features[idx]] = [
        q.features[idx],
        q.features[idx - 1],
      ];
      break;
    case "drawing note":
      q.workspaces = { ...q.workspaces, drawing: { note: label } };
      break;
    case "change sketch kind":
      if (!f) return p;
      f.kind = f.kind === "revolve" ? "extrude" : "revolve";
      f.amount = f.kind === "revolve" ? "360 deg" : "depth";
      break;
    default:
      return p;
  }
  return q;
}
async function replay(actions) {
  globalThis.indexedDB = new IDBFactory();
  let store = await openJournal();
  await store.load();
  const history = [initial()],
    fingerprints = new Map();
  let index = 0;
  await store.write({ index, project: history[index] });
  try {
    for (const [step, a] of actions.entries()) {
      const p = history[index];
      if (a.type === "undo" || a.type === "redo") {
        const next = index + (a.type === "undo" ? -1 : 1);
        if (next >= 0 && next < history.length) {
          assert.deepEqual(await store.read(next), history[next]);
          index = next;
          await store.write({ index, project: null });
        }
      } else if (a.type === "file roundtrip") {
        const opened = validateProject(JSON.parse(JSON.stringify(p)));
        assert.deepEqual(opened, p);
      } else if (a.type === "autosave reload") {
        store.close();
        store = await openJournal();
        assert.deepEqual(await store.load(), {
          index,
          last: history.length - 1,
          project: p,
        });
      } else {
        const next = apply(p, a);
        if (next !== p) {
          index++;
          history.splice(index, history.length, next);
          await store.write({ index, project: next });
        }
      }
      const current = history[index];
      const rebuilt = await evaluateModel(
        validateProject(JSON.parse(JSON.stringify(current))),
      );
      const bodies = buildBodies(rebuilt.features);
      try {
        const seen = bodies.map((b) => ({
          name: b.name,
          ...geometry(b.shape),
        }));
        const active = current.features.filter((f) => !f.suppressed);
        assert.equal(seen.length, active.length);
        for (const [i, f] of active.entries()) {
          const sketch = current.sketches.find((s) => s.id === f.sketchId),
            w = Number(sketch.points[1].x),
            h = Number(sketch.points[2].y),
            depth = parseFloat(current.parameters[0].expression);
          const solid = seen[i],
            revolved = f.kind === "revolve";
          const wantedVolume = revolved ? Math.PI * h * h * w : w * h * depth;
          near(
            solid.volume,
            wantedVolume,
            0.001 * wantedVolume,
            "volume at step " + step,
          );
          const bb = revolved ? [0, -h, -h, w, h, h] : [0, 0, 0, w, h, depth];
          solid.bbox
            .flat()
            .forEach((v, j) => near(v, bb[j], 0.01, "bbox at step " + step));
          assert.equal(solid.name, f.name);
          assert(solid.valid);
          assert.equal(solid.solids, 1);
          assert.equal(solid.faces, revolved ? 3 : 6);
          assert.equal(solid.edges, revolved ? 3 : 12);
        }
        const key = JSON.stringify(current);
        if (fingerprints.has(key))
          assert.deepEqual(
            seen,
            fingerprints.get(key),
            "Identical saved revision rebuilt differently at step " + step,
          );
        fingerprints.set(key, seen);
      } finally {
        releaseBodies(bodies);
      }
    }
  } finally {
    store.close();
  }
}
async function shrink(actions, original) {
  // Delta debugging preserves the assertion class and invariant message. Recreate an isolated journal for every replay.
  const signature = (e) =>
    String(e.message).split(/ at step |: expected |\n/)[0];
  const reproduces = async (subset) => {
    try {
      await replay(subset);
      return false;
    } catch (e) {
      return signature(e) === signature(original);
    }
  };
  let out = actions;
  for (
    let stride = Math.max(1, Math.floor(out.length / 2));
    stride >= 1;
    stride = Math.floor(stride / 2)
  ) {
    let reduced = true;
    while (reduced) {
      reduced = false;
      for (let i = 0; i < out.length; i++) {
        const candidate = out.slice(0, i).concat(out.slice(i + stride));
        if (candidate.length && (await reproduces(candidate))) {
          out = candidate;
          reduced = true;
          break;
        }
      }
    }
  }
  return out;
}
const seeds = [];
let total = 0;
const start = performance.now();
try {
  if (process.env.QA_FUZZ_REPLAY) {
    await replay(
      JSON.parse(await readFile(process.env.QA_FUZZ_REPLAY)).actions,
    );
    console.log("PASS replay");
  } else {
    for (
      let i = 0;
      i < cap && (i === 0 || performance.now() - start < seconds * 1000);
      i++
    ) {
      const next = (seed + Math.imul(i, 0x9e3779b9)) >>> 0;
      const actions = generate(next, 20);
      seeds.push(next);
      try {
        await replay(actions);
      } catch (e) {
        const minimal = await shrink(actions, e);
        await save("fuzz-failure-" + next + ".json", {
          seed: next,
          original: actions,
          actions: minimal,
          reason: e.message,
        });
        throw e;
      }
      total += actions.length;
    }
    const result = {
      seed,
      seeds,
      actions: total,
      elapsedSeconds: (performance.now() - start) / 1000,
      perChain: 20,
      kinds,
      outcome: "PASS",
    };
    await save("fuzz.json", result);
    console.log(
      "PASS",
      total,
      "state/geometry verifications in",
      seeds.length,
      "fixed-seed chains.",
    );
  }
} finally {
  await api.close();
}
