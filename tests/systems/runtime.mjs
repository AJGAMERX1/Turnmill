import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import {
  setOC,
  getOC,
  measureShapeVolumeProperties,
  measureShapeSurfaceProperties,
  BoundingBox,
} from "replicad";

export const evidence = resolve(
  process.env.TURNMILL_QA_EVIDENCE || "test-evidence/systems",
);
export async function save(name, value) {
  const path = resolve(evidence, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
  );
}
export function near(actual, expected, tolerance, label) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}; measured ${actual}`,
  );
}
export async function runtime(withKernel = true) {
  const solver = "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm";
  const server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "qa-solver-path",
        enforce: "pre",
        resolveId(id) {
          if (id === solver + "?url") return "virtual:qa-solver-path";
        },
        load(id) {
          if (id === "virtual:qa-solver-path")
            return (
              "export default " +
              JSON.stringify(fileURLToPath(import.meta.resolve(solver)))
            );
        },
      },
    ],
  });
  if (withKernel)
    setOC(
      await initOC({
        wasmBinary: await readFile(
          new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
        ),
      }),
    );
  return {
    load: (name) => server.ssrLoadModule("/src/" + name + ".ts"),
    close: () => server.close(),
  };
}
export function geometry(shape) {
  const checker = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true);
  const bounds = new BoundingBox();
  const mass = measureShapeVolumeProperties(shape),
    surf = measureShapeSurfaceProperties(shape);
  try {
    getOC().BRepBndLib.AddOptimal(shape.wrapped, bounds.wrapped, false, false);
    const topology = {};
    for (const prop of ["faces", "edges", "solids"]) {
      const items = shape[prop];
      topology[prop] = items.length;
      items.forEach((s) => s.delete());
    }
    return {
      valid: checker.IsValid(),
      volume: mass.volume,
      area: surf.area,
      center: mass.centerOfMass,
      bbox: bounds.bounds,
      ...topology,
    };
  } finally {
    checker.delete();
    bounds.delete();
    mass.delete();
    surf.delete();
  }
}
export function boxSketch(id, x0, y0, x1, y1) {
  return {
    id,
    name: id,
    points: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(([x, y]) => ({ x: String(x), y: String(y) })),
    constraints: [],
  };
}
export function feature(id, sketchId, amount, kind = "extrude") {
  return {
    id,
    name: id,
    kind,
    sketchId,
    amount: String(amount),
    operation: "new",
    suppressed: false,
  };
}
export function project(sketches, features, extra = {}) {
  return {
    version: 1,
    id: "qa-model",
    name: "QA model",
    parameters: [],
    sketches,
    features,
    ...extra,
  };
}
export async function measureProject(api, p) {
  const { evaluateModel } = await api.load("buildModel"),
    { buildBodies, releaseBodies } = await api.load("geometry");
  const model = await evaluateModel(p);
  const bodies = buildBodies(model.features);
  try {
    return bodies.map(({ name, shape }) => ({ name, ...geometry(shape) }));
  } finally {
    releaseBodies(bodies);
  }
}
export async function xfail(id, title, body) {
  try {
    await body();
  } catch (error) {
    if (error.code !== "ERR_ASSERTION") throw error;
    const result = { id, title, outcome: "XFAIL", message: error.message };
    await save(id + "/result.json", result);
    console.log("XFAIL", id, title, error.message);
    return result;
  }
  throw Error(
    "XPASS " +
      id +
      " " +
      title +
      "; review and remove its expected-failure marker.",
  );
}
