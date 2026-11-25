import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import {
  getOC,
  measureShapeVolumeProperties,
  measureShapeSurfaceProperties,
  setOC,
} from "replicad";

const out = resolve(process.env.QA_INTEROP_OUT || "test-evidence/interop");
await mkdir(out, { recursive: true });
const solver = "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  plugins: [
    {
      name: "qa-local-solver",
      enforce: "pre",
      resolveId(id) {
        if (id === solver + "?url") return "virtual:qa-local-solver";
      },
      load(id) {
        if (id === "virtual:qa-local-solver")
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
const load = (name) => server.ssrLoadModule("/src/" + name);
const { buildBodies, exportBodies, releaseBodies } = await load("geometry.ts");
const { exportAssemblyBodies } = await load("assemblyExport.ts");
const { positioned } = await load("motionGeometry.ts");
const { evaluateModel } = await load("buildModel.ts");
const { blankProject } = await load("projects.ts");
const { insertHardware } = await load("hardware.ts");
const { importSolidFile } = await load("exchangeSolids.ts");
const json = (name, x) =>
  writeFile(join(out, name), JSON.stringify(x, null, 2) + "\n");
function metrics({ name, shape }) {
  const mass = measureShapeVolumeProperties(shape),
    surface = measureShapeSurfaceProperties(shape);
  const box = shape.boundingBox,
    faces = shape.faces,
    edges = shape.edges,
    solids = shape.solids;
  const checker = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true);
  try {
    return {
      name,
      volume: mass.volume,
      area: surface.area,
      bbox: box.bounds,
      center: mass.centerOfMass,
      faces: faces.length,
      edges: edges.length,
      solids: solids.length,
      valid: checker.IsValid(),
    };
  } finally {
    checker.delete();
    box.delete();
    mass.delete();
    surface.delete();
    [...faces, ...edges, ...solids].forEach((x) => x.delete());
  }
}
function append(project, id, name, kind, pts, amount, operation = "new") {
  project.sketches.push({
    id: id + "-profile",
    name: name + " profile",
    points: pts.map(([x, y]) => ({ x: x + " mm", y: y + " mm" })),
    constraints: [],
  });
  project.features.push({
    id,
    name,
    kind,
    operation,
    sketchId: id + "-profile",
    amount: amount + (kind === "revolve" ? " deg" : " mm"),
    suppressed: false,
  });
}
const rect = (x, y, l, w) => [
  [x, y],
  [x + l, y],
  [x + l, y + w],
  [x, y + w],
];
async function save(name, p, expected = null, pose = null) {
  await json(name + ".turnmill", p);
  const model = await evaluateModel(p);
  const bodies = buildBodies(model.features);
  const write = async (id, selected, ref, view = null) => {
    const records = selected.map((body, i) => {
      if (!view) return metrics(body);
      const shape = positioned(body.shape, view.matrices[i]);
      try { return metrics({ ...body, shape }); }
      finally { shape.delete(); }
    });
    const row = {
      model: name,
      expected: ref,
      parts: records,
      ...(view ? { installedPose: view } : {}),
      stl: { linearMm: 0.005, angularRadians: 0.08 },
    };
    for (const format of ["step", "stl", "3mf"]) {
      const blob = view ? exportAssemblyBodies(selected, format, {
        ids: view.ids, joints: p.workspaces?.joints ?? {}, drivers: view.drivers, parameters: p.parameters,
      }) : exportBodies(selected, format);
      await writeFile(
        join(out, id + "." + format),
        Buffer.from(await blob.arrayBuffer()),
      );
    }
    await json(id + ".native.json", row);
    console.log(
      "export",
      id,
      records.map((x) => [x.name, x.volume]),
    );
  };
  try {
    await write(name, bodies, expected, pose);
    if (bodies.length > 1) {
      const starts = p.features
        .map((f, i) => (f.operation === "new" && !f.suppressed ? i : -1))
        .filter((i) => i >= 0);
      for (let i = 0; i < bodies.length; i++) {
        const id = name + "-" + (i + 1);
        await write(id, [bodies[i]], null);
        await json(id + ".turnmill", {
          ...p,
          name: bodies[i].name,
          features: p.features.slice(starts[i], starts[i + 1]),
        });
      }
    }
  } finally {
    releaseBodies(bodies);
  }
}
const part = () => ({ ...blankProject(), features: [], sketches: [] });
async function simple() {
  let p = part();
  append(p, "cyl", "Analytic cylinder", "revolve", rect(0, 0, 100, 5), 360);
  await save("cylinder", p, {
    formula: "π × 5² × 100",
    volume: Math.PI * 2500,
    bbox: [
      [0, -5, -5],
      [100, 5, 5],
    ],
    center: [50, 0, 0],
  });
  p = part();
  append(p, "b", "Analytic block", "extrude", rect(0, 0, 20, 10), 5);
  await save("block", p, {
    formula: "20 × 10 × 5",
    volume: 1000,
    bbox: [
      [0, 0, 0],
      [20, 10, 5],
    ],
    center: [10, 5, 2.5],
  });
  p = part();
  append(p, "r", "Aluminum ruler stock", "extrude", rect(0, 0, 155.4, 20), 2);
  await save("ruler-blank", p, {
    formula: "155.4 × 20 × 2",
    volume: 6216,
    bbox: [
      [0, 0, 0],
      [155.4, 20, 2],
    ],
    center: [77.7, 10, 1],
  });
  p = part();
  append(p, "a", "Hinge leaf A", "revolve", rect(0, 2, 7.9, 1.2), 360);
  append(
    p,
    "tab-a",
    "Leaf A flange",
    "extrude",
    rect(0, 2.5, 7.9, 7),
    1,
    "add",
  );
  append(p, "b", "Hinge leaf B", "revolve", rect(8.1, 2, 7.9, 1.2), 360);
  append(
    p,
    "tab-b",
    "Leaf B flange",
    "extrude",
    rect(8.1, -9.5, 7.9, 7),
    1,
    "add",
  );
  append(p, "pin", "Hinge pin", "revolve", rect(-0.5, 0, 17, 1.95), 360);
  p.workspaces = {
    joints: {
      b: {
        kind: "revolute",
        parent: "a",
        axis: "X",
        min: "0 deg",
        max: "180 deg",
        origin: ["0", "0", "0"],
        offset: ["0", "0", "0"],
      },
    },
  };
  await save("hinge", p);
}
async function rod() {
  const p = part();
  append(p, "rod", "Plain threaded rod", "revolve", rect(0, 0, 8, 2.5), 360);
  p.features[0].finishes = [
    {
      id: "m5",
      name: "M5 × 0.8",
      kind: "thread",
      diameter: "5 mm",
      length: "4 mm",
      pitch: "0.8 mm",
      end: "end",
      preset: "M5 × 0.8",
      side: "external",
      mode: "modeled",
      hand: "right",
    },
  ];
  // Integrate r² over one pitch, including the flat crest, flat root and two straight 60° flanks.
  const R = 2.5,
    r = R - (5 * Math.sqrt(3) * 0.8) / 16;
  const plain = Math.PI * R * R,
    threaded =
      Math.PI *
      ((R * R) / 8 + (r * r) / 4 + (5 * (R * R + R * r + r * r)) / 24);
  const volume = 4 * (plain + threaded);
  await save("threaded-rod", p, {
    formula: "4πR² + 4π[R²/8 + r²/4 + 5(R²+Rr+r²)/24], R=2.5, r=R−5√3·0.8/16",
    volume,
    bbox: [
      [0, -2.5, -2.5],
      [8, 2.5, 2.5],
    ],
    center: [(2 * 4 * plain + 6 * 4 * threaded) / volume, 0, 0],
  });
}
async function hardware() {
  let p = insertHardware(part(), "screw", 2, "12 mm", "modeled");
  p = insertHardware(p, "nut", 2, "4 mm", "modeled");
  await save("m5-kit", p);
}
async function hardwareRegression() {
  const p = insertHardware(part(), "screw", 2, "12 mm", "modeled");
  const { features } = await evaluateModel(p);
  try {
    const bodies = buildBodies(features);
    releaseBodies(bodies);
  } catch (error) {
    if (!/M5 × 0.8.*one connected body/.test(error.message)) throw error;
    console.log(
      "XFAIL INTEROP-001 12 mm M5 modeled library screw should build as one valid solid:",
      error.message,
    );
    return;
  }
  throw Error(
    "XPASS INTEROP-001 — remove the known-failure mark after reviewing the result.",
  );
}
async function hardwareAlternates() {
  await save("m5-nut", insertHardware(part(), "nut", 2, "4 mm", "modeled"));
  const cosmetic = insertHardware(part(), "screw", 2, "12 mm", "cosmetic");
  await save("m5-cosmetic", cosmetic);
}
async function pen() {
  const p = JSON.parse(await readFile("examples/twist-pen.turnmill", "utf8"));
  await save("twist-pen", p);
}
async function ruler() {
  const p = JSON.parse(
    await readFile("examples/pocket-ruler.turnmill", "utf8"),
  );
  p.parameters.find((a) => a.name === "blank_length").expression = "155.4 mm";
  p.parameters.find((a) => a.name === "mark_depth").expression = "0.2 mm";
  const { getScaleLayout } = await load("secondaryEngraving.ts"),
    { makeScale, outlinedGraduations } = await load("secondaryScale.ts");
  const { resolveParameters } = await load("expressions.ts"),
    { svgFile, dxfFile } = await load("secondaryVector.tsx");
  const c = getScaleLayout(p.workspaces.scale, resolveParameters(p.parameters)),
    sheet = outlinedGraduations(makeScale(c).geometry, c);
  await writeFile(join(out, "ruler.dxf"), dxfFile(sheet));
  await writeFile(join(out, "ruler.svg"), svgFile(sheet));
  await json("ruler-layout.json", c);
  await save("ruler", p);
}
async function terminal() {
  const p = JSON.parse(
    await readFile("examples/pocket-ruler.turnmill", "utf8"),
  );
  const { getScaleLayout } = await load("secondaryEngraving.ts"),
    { makeScale, outlinedGraduations } = await load("secondaryScale.ts");
  const { svgFile, dxfFile } = await load("secondaryVector.tsx");
  const cfg = {
    ...p.workspaces.scale,
    length: "155 mm",
    offset: "2 mm",
    width: "22 mm",
    weight: "0.15 mm",
  };
  const c = getScaleLayout(cfg, {}),
    sheet = outlinedGraduations(makeScale(c).geometry, c);
  await writeFile(join(out, "terminal.dxf"), dxfFile(sheet));
  await writeFile(join(out, "terminal.svg"), svgFile(sheet));
}
async function projects() {
  const base = resolve(process.env.TURNMILL_PROJECT_EVIDENCE || "test-evidence/projects");
  const required = ["bolt-library/bolt-nut", "bolt-scratch/bolt-nut", "click-pen/click-study", "click-coil/click-with-coil", "hinge/hinge", "pen/twist-pen", "ruler/graduated-ruler"];
  for (const stem of required) {
    if (process.env.QA_ONLY_CASE && !("ui-"+stem.replace("/","-")).startsWith(process.env.QA_ONLY_CASE)) continue;
    for (const ext of [".turnmill",".step"]) {
      const file=join(base,stem+ext);
      try {await access(file);} catch {throw Error("Missing project export "+file+". Run the corresponding production UI scenario first.");}
    }
  }
  for (const dir of await readdir(base)) {
    const folder = join(base, dir);
    const files = await readdir(folder).catch(() => []);
    for (const file of files.filter((f) => f.endsWith(".turnmill"))) {
      const stem = file.slice(0, -9);
      if (!files.includes(stem + ".step")) continue;
      const name = "ui-" + dir + "-" + stem;
      const project = JSON.parse(await readFile(join(folder, file), "utf8"));
      if (
        process.env.QA_ONLY_CASE &&
        !name.startsWith(process.env.QA_ONLY_CASE)
      )
        continue;
      const assembly = ["bolt-library/bolt-nut", "bolt-scratch/bolt-nut", "click-coil/click-with-coil"].includes(dir + "/" + stem);
      const pose = assembly ? JSON.parse(await readFile(join(folder, stem + ".pose.json"))) : null;
      await save(name, project, null, pose);
      // Benchmark the actual UI-emitted assembly STEP; per-body and STL/3MF exports use the same kernel entry point.
      await writeFile(
        join(out, name + ".step"),
        await readFile(join(folder, stem + ".step")),
      );
    }
  }
}
async function reverse() {
  const rows = [];
  for (const f of (await readdir(out)).filter(
    (n) =>
      n.endsWith(".return.step") ||
      (n.startsWith("fc-") && n.endsWith(".step")),
  )) {
    try {
      const bodies = await importSolidFile(
        "step",
        new Blob([await readFile(join(out, f))]),
        f.replace(/\.step$/i, ""),
      );
      try {
        rows.push({ file: f, parts: bodies.map(metrics) });
      } finally {
        releaseBodies(bodies);
      }
    } catch (e) {
      rows.push({ file: f, error: e.message });
    }
  }
  await json("reverse.json", rows);
}
try {
  for (const command of process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        "simple",
        "rod",
        "hardwareRegression",
        "hardwareAlternates",
        "pen",
        "ruler",
        "terminal",
      ])
    await {
      simple,
      rod,
      hardware,
      hardwareRegression,
      hardwareAlternates,
      pen,
      ruler,
      terminal,
      projects,
      reverse,
    }[command]();
} finally {
  await server.close();
}
