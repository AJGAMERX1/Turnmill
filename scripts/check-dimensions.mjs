import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { setOC } from "replicad";

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
  setOC(
    await initOC({
      wasmBinary: await readFile(
        new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
      ),
    }),
  );
  const { evaluateModel } = await server.ssrLoadModule("/src/buildModel.ts");
  const { buildBodies, releaseBodies } =
    await server.ssrLoadModule("/src/geometry.ts");
  const { projectSolid } = await server.ssrLoadModule(
    "/src/secondaryProjection.ts",
  );
  const {
    formatTolerance,
    dimensionSnaps,
    sectionSnaps,
    findSnap,
    measureDimension,
    dimensionLayout,
    dimensionMarks,
    orthographic,
  } = await server.ssrLoadModule("/src/drawingDimensions.ts");
  const { manufacturingSheets } = await server.ssrLoadModule(
    "/src/secondaryManufacturing.ts",
  );
  const { svgFile, dxfFile } = await server.ssrLoadModule(
    "/src/secondaryVector.tsx",
  );

  const { drawingSources, partSheetKey } = await server.ssrLoadModule(
    "/src/drawingSheetSettings.ts",
  );
  const legacy = {
    feature: "plate",
    title: "Gauge no. 4",
    tolerance: "0.03 mm",
    number: "G-4",
    detail: true,
    detailWidth: "2 mm",
    note: "Deburr",
    assemblyTitle: "Gauge fit",
    material: "Brass",
  };
  const migrated = drawingSources(legacy, "other");
  assert.equal(migrated[partSheetKey("plate")].tolerance, "0.03 mm");
  assert.equal(migrated[partSheetKey("plate")].detailWidth, "2 mm");
  assert.deepEqual(migrated.assembly, { title: "Gauge fit" });
  assert.equal(migrated[partSheetKey("other")], undefined);
  assert.deepEqual(
    drawingSources({ ...legacy, feature: "other", sources: migrated }, "other"),
    migrated,
  );

  const project = {
    version: 1,
    id: "dimension-check",
    name: "Gauge plate",
    parameters: [
      { name: "width", expression: "40 mm" },
      { name: "drill_offset", expression: "4 mm" },
    ],
    sketches: [
      {
        id: "base",
        name: "Plate",
        constraints: [],
        points: [
          ["0", "0"],
          ["width", "0"],
          ["width", "20"],
          ["0", "20"],
        ].map(([x, y]) => ({ x, y })),
      },
    ],
    features: [
      {
        id: "plate",
        name: "Plate",
        kind: "extrude",
        amount: "5 mm",
        operation: "new",
        suppressed: false,
        sketchId: "base",
        finishes: [
          {
            kind: "hole",
            id: "pilot",
            name: "Pilot",
            end: "end",
            profile: "counterbore",
            termination: "through",
            length: "5",
            diameter: "3",
            seatDiameter: "5",
            seatDepth: "1",
            offsetU: "drill_offset",
            offsetV: "2",
          },
        ],
      },
    ],
  };
  const options = {
    title: "Gauge plate",
    number: "GD-1",
    revision: "A",
    material: "Brass",
    note: "",
    dimensions: true,
    hatch: true,
    scale: "auto",
    measures: [],
  };
  async function inspect(p) {
    const model = await evaluateModel(p),
      bodies = buildBodies(model.features);
    try {
      const result = projectSolid(bodies[0].shape);
      const snaps = Object.fromEntries(
        orthographic.map((v) => [
          v,
          dimensionSnaps(v, result.views[v], model.features, p),
        ]),
      );
      snaps.section = sectionSnaps(
        result.views.section,
        result.sectionAxis,
        result.sectionOffset,
        p,
        false,
      );
      return { model, result, snaps };
    } finally {
      releaseBodies(bodies);
    }
  }
  const first = await inspect(project);
  const center = first.snaps.top.find((s) => s.name === "Pilot center");
  assert.ok(center, "OpenCascade must supply a pickable analytic hole center");
  assert.deepEqual(center.xy, [24, 12]);
  assert.equal(
    first.snaps.top.filter(
      (s) => s.kind === "center" && s.xy[0] === 24 && s.xy[1] === 12,
    ).length,
    1,
  );
  const base = {
    id: "d1",
    view: "top",
    a: "extent:0:0",
    b: center.key,
    mode: "horizontal",
    offset: "-24 mm",
    tolerance: "symmetric",
    plus: "0.05 mm",
    minus: "0",
  };
  const measure = (p, d) =>
    measureDimension(d, p.snaps[d.view], p.model.values);
  assert.equal(measure(first, base).text, "24 ±0.05");
  assert.equal(formatTolerance(0.00000123456789), "0.00000123456789");
  assert.equal(
    measure(first, { ...base, plus: "0.0000000123456789 mm" }).text,
    "24 ±1.23456789e-8",
  );
  const turning = structuredClone(project);
  turning.features[0].kind = "revolve";
  turning.features[0].amount = "360 deg";
  turning.features[0].finishes = [];
  const turned = await inspect(turning);
  const { surfaceKey } = await server.ssrLoadModule(
    "/src/secondaryManufacturing.ts",
  );
  const formPages = manufacturingSheets(
    turned.result,
    options,
    turned.model.features,
    formatTolerance(0.00000123456789),
    {
      form: {
        kind: "roundness",
        key: surfaceKey(turned.result.stations[0]),
        value: 0.00000123456789,
      },
    },
  ).sheets;
  assert.ok(
    formPages.some((page) =>
      svgFile(page.sheet).includes("± 0.00000123456789"),
    ),
  );
  assert.ok(
    formPages.some((page) =>
      svgFile(page.sheet).includes(">0.00000123456789<"),
    ),
  );
  const height = {
    ...base,
    id: "d2",
    view: "right",
    a: "extent:1:0",
    b: "extent:0:1",
    mode: "vertical",
    offset: "16",
    tolerance: "bilateral",
    plus: "0.02",
    minus: "0.01",
  };
  assert.equal(measure(first, height).text, "5 +0.02/−0.01");
  const diagonal = {
    ...base,
    id: "d3",
    mode: "aligned",
    offset: "8",
    tolerance: "general",
  };
  assert.equal(measure(first, diagonal).value, Math.hypot(24, 12));
  assert.equal(
    measure(first, { ...diagonal, a: diagonal.b, b: diagonal.a }).value,
    measure(first, diagonal).value,
  );
  assert.throws(
    () => measure(first, { ...base, b: "extent:0:1" }),
    /points coincide/,
  );
  assert.throws(
    () => measure(first, { ...base, plus: "-1 mm" }),
    /zero or more/,
  );
  const dim = measure(first, base),
    layout = dimensionLayout(first.result.views.top, "auto");
  assert.throws(
    () => dimensionMarks({ ...dim, offset: 220 }, layout.at),
    /outside the view/,
  );
  const left = first.snaps.section.find((s) => s.name === "Lower left corner"),
    right = first.snaps.section.find((s) => s.name === "Lower right corner");
  assert.ok(left && right);
  const span = {
    ...base,
    id: "d4",
    view: "section",
    a: left.key,
    b: right.key,
    offset: "8 mm",
    tolerance: "general",
  };
  assert.equal(measure(first, span).value, 40);
  assert.throws(
    () =>
      measureDimension(
        span,
        sectionSnaps(first.result.views.section, "Y", 1, project, false),
        first.model.values,
      ),
    /missing/,
  );
  const sectionPage = manufacturingSheets(
    first.result,
    options,
    first.model.features,
    "",
    { manualDimensions: [measure(first, span)] },
  ).sheets.at(-1);
  assert.equal(sectionPage.label, "Section A–A dimensions");
  assert.match(svgFile(sectionPage.sheet), /Section_hatch/);

  const spec = [base, height, diagonal],
    measured = spec.map((d) => measure(first, d));
  const { sheets } = manufacturingSheets(
    first.result,
    options,
    first.model.features,
    "0.1",
    { manualDimensions: measured },
  );
  assert.deepEqual(
    sheets.map((s) => s.label),
    [
      "Views and section",
      "Dimensions and callouts",
      "Top dimensions",
      "Right dimensions",
    ],
  );
  for (const [i, s] of sheets.entries())
    assert.ok(s.sheet.marks.some((m) => m.value === `${i + 1} / 4`));
  const svg = svgFile(sheets[2].sheet),
    dxf = dxfFile(sheets[3].sheet);
  assert.match(svg, /data-layer="Manual_dimensions"/);
  assert.match(svg, /24 ±0.05/);
  assert.match(dxf, /Manual_dimensions/);
  assert.ok(dxf.includes("5 +0.02/\\U+22120.01"));
  const changed = structuredClone(project);
  changed.parameters[0].expression = "50 mm";
  changed.parameters[1].expression = "2.5 mm";
  const rebuilt = await inspect(changed);
  assert.equal(measure(rebuilt, base).text, "27.5 ±0.05");
  assert.equal(measure(rebuilt, span).value, 50);
  assert.equal(
    rebuilt.snaps.top.find((s) => s.name === "Pilot center").key,
    center.key,
  );
  const changedHole = structuredClone(project);
  changedHole.features[0].finishes[0].id = "replacement";
  const missing = await inspect(changedHole);
  assert.throws(() => measure(missing, base), /missing/);
  assert.equal(
    measure(missing, {
      ...base,
      b: missing.snaps.top.find((s) => s.name === "Pilot center").key,
    }).value,
    24,
  );
  const profile = structuredClone(project);
  profile.features[0].finishes = [];
  profile.sketches[0].points.splice(
    2,
    0,
    { x: "width", y: "7" },
    { x: "width - 3", y: "7" },
    { x: "width - 3", y: "12" },
    { x: "width", y: "12" },
  );
  const notched = await inspect(profile);
  const shoulder = notched.snaps.top.find(
    (s) => Math.abs(s.xy[0] - 37) < 1e-6 && Math.abs(s.xy[1] - 7) < 1e-6,
  );
  assert.ok(shoulder?.key.includes("width - 3"));
  profile.parameters[0].expression = "43 mm";
  const notchedAgain = await inspect(profile);
  assert.deepEqual(findSnap(notchedAgain.snaps.top, shoulder.key).xy, [40, 7]);
  console.log(
    "Finished-body dimensions passed: B-rep hole centers, three measurement directions, tolerances, sheet paging, SVG/DXF, profile and hole rebuilds, missing references and repair.",
  );
} finally {
  await server.close();
}
