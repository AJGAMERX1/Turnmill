import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { setOC, makeCylinder, makeBox, measureVolume } from "replicad";
const solverPath = fileURLToPath(
  import.meta.resolve("@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm"),
);
const server = await createServer({
  plugins: [
    {
      name: "local-solver-url",
      enforce: "pre",
      load(id) {
        if (id.endsWith("/planegcs.wasm?url"))
          return "export default " + JSON.stringify(solverPath);
      },
    },
  ],
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const { fitLimits } = await server.ssrLoadModule("/src/secondaryAssembly.ts");
  const near = (x, y, tol = 1e-7) =>
    assert.ok(Math.abs(x - y) < tol, "expected " + y + ", got " + x);
  // Schaeffler HG 1 tables. Check band transitions at the upper-inclusive nominal.
  for (const [upper, hole, gLower, gUpper, kLower, kUpper, pLower, pUpper] of [
    [3, 10, -8, -2, 0, 6, 6, 12],
    [6, 12, -12, -4, 1, 9, 12, 20],
    [10, 15, -14, -5, 1, 10, 15, 24],
    [18, 18, -17, -6, 1, 12, 18, 29],
    [30, 21, -20, -7, 2, 15, 22, 35],
    [50, 25, -25, -9, 2, 18, 26, 42],
  ]) {
    const prev = {
      3: 1,
      6: 3.000001,
      10: 6.000001,
      18: 10.000001,
      30: 18.000001,
      50: 30.000001,
    }[upper];
    for (const diameter of [prev, upper]) {
      for (const [fit, lo, hi] of [
        ["H7/g6", gLower, gUpper],
        ["H7/h6", gLower - gUpper, 0],
        ["H7/k6", kLower, kUpper],
        ["H7/p6", pLower, pUpper],
      ]) {
        const r = fitLimits(diameter, fit);
        near(r.holeMin, diameter);
        near(r.holeMax, diameter + hole / 1000);
        near(r.shaftMin, diameter + lo / 1000);
        near(r.shaftMax, diameter + hi / 1000);
        near(r.min, -hi / 1000);
        near(r.max, (hole - lo) / 1000);
        near(r.min, r.holeMin - r.shaftMax);
        near(r.max, r.holeMax - r.shaftMin);
      }
    }
  }
  for (const d of [0, 0.99, 50.001, NaN, Infinity])
    assert.equal(fitLimits(d), null);
  assert.equal(fitLimits(3, "H7/p6").kind, "Transition fit");
  assert.equal(fitLimits(6, "H7/p6").kind, "Interference fit");
  assert.equal(fitLimits(12, "H7/h6").kind, "Clearance fit");
  assert.equal(fitLimits(25, "H7/k6").kind, "Transition fit");
  setOC(
    await initOC({
      wasmBinary: await readFile(
        new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
      ),
    }),
  );
  const { collectFitSurfaces } = await server.ssrLoadModule(
    "/src/fitSurfaces.ts",
  );
  const { matingResult } = await server.ssrLoadModule("/src/MatingFits.tsx");
  const { assemblyParts, bomCsv } = await server.ssrLoadModule(
    "/src/AssemblyBom.tsx",
  );
  const owned = [];
  const own = (s) => {
    owned.push(s);
    return s;
  };
  try {
    const OD = own(makeCylinder(8, 8)),
      core = own(makeCylinder(5, 10, [0, 0, -1])),
      sleeve = own(OD.cut(core)),
      pin = own(makeCylinder(5, 10));
    const sleeveSurfaces = collectFitSurfaces(sleeve, "sleeve"),
      bores = sleeveSurfaces.filter((s) => s.side === "bore"),
      pins = collectFitSurfaces(pin, "pin");
    assert.equal(bores.length, 1);
    assert.equal(sleeveSurfaces.length, 2);
    assert.equal(pins.length, 1);
    assert.equal(pins[0].side, "shaft");
    near(pins[0].diameter, 10);
    near(bores[0].diameter, 10);
    const pair = matingResult(bores[0], pins[0], "H7/g6");
    near(pair.limits.min, 0.005);
    near(pair.limits.max, 0.029);
    assert.ok(
      matingResult(
        bores[0],
        sleeveSurfaces.find((s) => s.side === "shaft"),
        "H7/k6",
      ).error,
    );
    assert.ok(matingResult(undefined, pins[0], "H7/k6").error);
    const enlarged = own(makeCylinder(5.5, 10));
    const resized = collectFitSurfaces(enlarged, "pin")[0];
    assert.equal(resized.key, pins[0].key);
    assert.match(
      matingResult(bores[0], resized, "H7/g6").error,
      /diameters differ/,
    );
    const shortened = own(makeCylinder(5, 8));
    assert.notEqual(collectFitSurfaces(shortened, "pin")[0].key, pins[0].key);
    const crossDrill = own(makeCylinder(1, 25, [-10, 0, 4], [1, 0, 0])),
      ported = own(pin.cut(crossDrill));
    assert.equal(
      collectFitSurfaces(ported, "pin").some((s) => s.key === pins[0].key),
      false,
      "Interrupted cylindrical land must not get a smooth-shaft fit",
    );
    const angled = own(makeCylinder(3, 12, [11, 0, 4], [1, 2, 3])),
      tilted = collectFitSurfaces(angled, "angled")[0];
    near(tilted.diameter, 6);
    near(tilted.end - tilted.start, 12);
    const clip = own(makeBox([-8, -8, -1], [0, 8, 12])),
      half = own(pin.cut(clip));
    assert.equal(collectFitSurfaces(half, "pin").length, 0);
    const { insertHardware, stockSpring } =
      await server.ssrLoadModule("/src/hardware.ts");
    const { makeReferenceSpring } = await server.ssrLoadModule(
      "/src/hardwareSpring.ts",
    );
    const { evaluate } = await server.ssrLoadModule("/src/expressions.ts");
    const spring = own(
      makeReferenceSpring(
        evaluate(stockSpring.od),
        evaluate(stockSpring.wire),
        evaluate(stockSpring.length),
        evaluate(stockSpring.turns, {}, "scalar"),
      ),
    );
    const b = spring.boundingBox;
    try {
      const [[xmin, ymin, zmin], [xmax, ymax, zmax]] = b.bounds;
      near(zmax - zmin, 8.636, 0.002);
      near(xmax - xmin, 4.3688, 0.002);
      near(ymax - ymin, 4.3688, 0.002);
    } finally {
      b.delete();
    }
    const project = {
      id: "check",
      version: 1,
      name: "Assembly",
      parameters: [],
      features: [],
      sketches: [],
    };
    const { evaluateModel } = await server.ssrLoadModule("/src/buildModel.ts");
    const { buildBodies, releaseBodies } =
      await server.ssrLoadModule("/src/geometry.ts");
    // M4 hardware envelope and the 2-007 O-ring. The cosmetic threads preserve stock volume.
    const hexArea = (7 ** 2 * Math.sqrt(3)) / 2;
    for (const [kind, expected] of [
      ["screw", Math.PI * 2 ** 2 * 10 + hexArea * 2.8],
      ["nut", (hexArea - Math.PI * ((4 - 0.7 * 1.08253175473) / 2) ** 2) * 3.2],
      ["washer", (Math.PI * (9 ** 2 - 4.3 ** 2) * 0.8) / 4],
      ["pin", Math.PI * 2 ** 2 * 10],
      ["oring", 2 * Math.PI ** 2 * ((3.68 + 1.78) / 2) * 0.89 ** 2],
    ]) {
      const hardware = insertHardware(project, kind, 1, "10 mm", "cosmetic");
      const { features } = await evaluateModel(hardware);
      const bodies = buildBodies(features);
      try {
        assert.equal(bodies.length, 1, kind);
        near(measureVolume(bodies[0].shape), expected, 1e-5);
        assert.equal(assemblyParts(hardware, features).length, 1, kind);
      } finally {
        releaseBodies(bodies);
      }
    }
    const h = insertHardware(project, "screw", 0, "10 mm", "cosmetic");
    h.features[0].name = 'Cap "screw"';
    h.features.push({
      id: "other",
      operation: "new",
      kind: "import",
      name: "Washer",
      suppressed: false,
    });
    h.workspaces.joints = {
      [h.features[0].id]: { kind: "screw", parent: "other" },
    };
    const rows = assemblyParts(h, h.features);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].material, "Steel");
    assert.equal(rows[0].parent, "Washer");
    assert.equal(rows[1].source, "Imported body");
    assert.equal(rows[0].source, "Hex screw");
    assert.match(rows[0].specification, /length 10 mm/);
    const csv = bomCsv(rows);
    assert.match(csv, /"Cap ""screw"""/);
    const d = h.parameters.find((p) => p.name.endsWith("_length"));
    d.expression = "1/2 in";
    assert.match(
      assemblyParts(h, h.features)[0].specification,
      /length 12.7 mm/,
    );
  } finally {
    owned.reverse().forEach((s) => s.delete());
  }
  console.log(
    "Passed 48 fit-limit cases, cylindrical feature matching and repair, all six hardware families, and model-derived hardware BOM checks.",
  );
} finally {
  await server.close();
}
