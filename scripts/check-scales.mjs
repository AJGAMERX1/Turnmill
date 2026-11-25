import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { measureVolume, measureShapeVolumeProperties, setOC } from "replicad";

const wasmBinary = await readFile(
  new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
);
setOC(await initOC({ wasmBinary }));
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
function close(a, b, eps = 1e-7) {
  assert.ok(Math.abs(a - b) < eps, `Expected ${b}, got ${a}`);
}
try {
  const {
    getScaleLayout,
    evaluateScaleStock,
    withScaleAttachment,
    withScaleModel,
    isScaleFeature,
  } = await server.ssrLoadModule("/src/secondaryEngraving.ts");
  const { makeScale, outlinedGraduations } = await server.ssrLoadModule(
    "/src/secondaryScale.ts",
  );
  const { resolveParameters, evaluate } = await server.ssrLoadModule(
    "/src/expressions.ts",
  );
  const { validateProject } = await server.ssrLoadModule("/src/projects.ts");
  const { svgFile, dxfFile } = await server.ssrLoadModule(
    "/src/secondaryVector.tsx",
  );
  const { buildBodies, exportBodies, releaseBodies } =
    await server.ssrLoadModule("/src/geometry.ts");
  const { importSolidFile } = await server.ssrLoadModule(
    "/src/exchangeSolids.ts",
  );
  const { flattenInk } = await server.ssrLoadModule("/src/secondaryInk.ts");
  const p = validateProject(
    JSON.parse(
      await readFile(
        new URL("../examples/pocket-ruler.turnmill", import.meta.url),
        "utf8",
      ),
    ),
  );
  const cfg = p.workspaces.scale,
    values = resolveParameters(p.parameters);
  const layout = getScaleLayout(cfg, values),
    scale = makeScale(layout);
  const strokes = scale.geometry.marks.filter((m) => m.type === "path");
  const top = strokes.filter((m) => m.pts[0][1] === 0),
    bottom = strokes.filter((m) => m.pts[0][1] === 18);
  assert.equal(top.length, 52);
  assert.equal(bottom.length, 33);
  close(top[50].pts[0][0] - top[0].pts[0][0], 50);
  close(bottom[32].pts[0][0] - bottom[0].pts[0][0], 50.8);
  close(bottom[1].pts[0][0] - bottom[0].pts[0][0], 1.5875);
  const range = outlinedGraduations(scale.geometry, layout);
  assert.equal(
    range.marks.filter((m) => m.layer === "Graduation_outlines").length,
    85,
  );
  for (const i of [0, 5, 11]) {
    const m = range.marks.filter((m) => m.layer === "Graduation_outlines")[i];
    close(
      Math.max(...m.pts.map((p) => p[0])) - Math.min(...m.pts.map((p) => p[0])),
      i === 0 ? 0.2 : i === 5 ? 0.14 : 0.1,
    );
  }
  const sv = svgFile(range),
    dx = dxfFile(range);
  assert.match(sv, /width="52mm"/);
  assert.match(sv, /height="18mm"/);
  assert.match(dx, /Graduation_outlines/);
  assert.doesNotMatch(dx, /\r\nTEXT\r\n/);
  for (const [unit, step] of Object.entries({
    mm: 1,
    cm: 1,
    in8: 25.4 / 8,
    in16: 25.4 / 16,
    in32: 25.4 / 32,
    ind: 2.54,
    custom: 1.25,
    architectural: 2,
  })) {
    const s = makeScale({
      ...layout,
      top: unit,
      bottom: "off",
      customStep: 1.25,
      customRatio: 20,
      architectureRatio: 50,
    }).geometry;
    const ticks = s.marks.filter((m) => m.type === "path");
    close(ticks[1].pts[0][0] - ticks[0].pts[0][0], step);
    if (unit === "architectural")
      assert.deepEqual(
        s.marks.filter((m) => m.type === "text").map((m) => m.value),
        ["0", "1", "2"],
      );
  }
  const separate = makeScale({
    ...layout,
    bottomLabels: { ...layout.bottomLabels, frequency: 2, rotation: 15 },
  });
  assert.deepEqual(
    separate.geometry.marks
      .filter((m) => m.type === "text" && m.rotation === 15)
      .map((m) => m.value),
    ["0", "2"],
  );
  function body(project, parameters) {
    const f = project.features[0],
      s = project.sketches[0];
    return {
      id: f.id,
      name: f.name,
      kind: f.kind,
      operation: "new",
      amount: evaluate(f.amount, parameters),
      points: s.points.map((q) => [
        evaluate(q.x, parameters),
        evaluate(q.y, parameters),
      ]),
    };
  }
  const stock = body(p, values),
    engraving = evaluateScaleStock(p, values, p.features[1]);
  const seeds = {
    ...p,
    features: [p.features[0]],
    sketches: [p.sketches[0]],
    workspaces: {
      ...p.workspaces,
      scale: { ...cfg, attachment: undefined, appliedId: undefined },
    },
  };
  const seeded = withScaleAttachment(seeds, values, cfg.attachment);
  assert.equal(seeded.features.length, 2);
  assert.ok(isScaleFeature(seeded, seeded.features[1].id));
  assert.equal(seeded.features[1].bodyId, stock.id);
  assert.notEqual(seeded.features[1].sketchId, stock.sketchId);
  const relinked = withScaleAttachment(seeded, values, {
    ...cfg.attachment,
    u: "1.1 mm",
  });
  assert.equal(relinked.features.length, 2);
  assert.equal(relinked.features[1].id, seeded.features[1].id);
  assert.equal(relinked.sketches.length, 2);
  const polygonArea = (points) =>
    Math.abs(
      points.reduce((sum, [x, y], i) => {
        const a = points[(i + 1) % points.length];
        return sum + x * a[1] - a[0] * y;
      }, 0) / 2,
    );
  const inkArea =
    engraving.ruler.ticks.reduce((s, q) => s + polygonArea(q), 0) +
    engraving.ruler.labels.reduce(
      (s, g) =>
        s +
        polygonArea(flattenInk(g.outer, 0.00001)) -
        g.holes.reduce((s, h) => s + polygonArea(flattenInk(h, 0.00001)), 0),
      0,
    );
  const solids = buildBodies([stock, engraving]);
  try {
    assert.equal(solids.length, 1);
    const removed = 54 * 20 * 2 - measureVolume(solids[0].shape);
    close(removed, inkArea * 0.18, 0.002);
    const step = exportBodies(solids, "step"),
      imported = await importSolidFile("step", step, "Pocket ruler");
    try {
      assert.equal(imported.length, 1);
      close(
        measureVolume(imported[0].shape),
        measureVolume(solids[0].shape),
        0.0002,
      );
    } finally {
      imported.forEach((b) => b.shape.delete());
    }
    console.log(
      `Pocket ruler: 85 ticks, ${removed.toFixed(6)} mm³ removed to 0.18 mm, STEP round-trip verified.`,
    );
  } finally {
    releaseBodies(solids);
  }
  const named = { ...values, blank_length: 58, mark_depth: 0.23 };
  const edited = evaluateScaleStock(p, named, p.features[1]);
  assert.equal(edited.ruler.depth, 0.23);
  assert.ok(edited.ruler.ticks.length > 85);
  const simple = {
    ...engraving,
    ruler: {
      depth: 0.25,
      ticks: [
        [
          [1, 2],
          [4, 2],
          [4, 3],
          [1, 3],
        ],
      ],
      labels: [],
      placement: { face: "top", angle: 0, u: 0, v: 0 },
    },
  };
  const cube = {
    ...stock,
    points: [
      [2, 4],
      [14, 4],
      [14, 16],
      [2, 16],
    ],
    amount: 12,
  };
  const expectedCenters = {
    top: [5.5, 7.5, 11.875],
    bottom: [5.5, 12.5, 0.125],
    front: [5.5, 4.125, 3.5],
    back: [10.5, 15.875, 3.5],
    right: [13.875, 7.5, 3.5],
    left: [2.125, 12.5, 3.5],
  };
  for (const [face, expected] of Object.entries(expectedCenters)) {
    const engraved = buildBodies([
      cube,
      {
        ...simple,
        ruler: { ...simple.ruler, placement: { face, u: 6, v: 1, angle: 90 } },
      },
    ]);
    try {
      const mass = measureShapeVolumeProperties(engraved[0].shape);
      try {
        close(mass.volume, 1728 - 0.75);
        const removedCenter = [8, 10, 6].map(
          (x, i) => (1728 * x - mass.volume * mass.centerOfMass[i]) / 0.75,
        );
        removedCenter.forEach((x, i) => close(x, expected[i], 1e-7));
      } finally {
        mass.delete();
      }
    } finally {
      releaseBodies(engraved);
    }
  }
  assert.throws(
    () =>
      buildBodies([
        cube,
        {
          ...simple,
          ruler: {
            ...simple.ruler,
            placement: { ...simple.ruler.placement, u: 10.9 },
          },
        },
      ]),
    /off the face/,
  );
  assert.throws(
    () =>
      buildBodies([cube, { ...simple, ruler: { ...simple.ruler, depth: 12 } }]),
    /thickness/,
  );
  const holed = {
    ...cube,
    points: [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
    ],
  };
  const slot = {
    ...cube,
    id: "slot",
    operation: "cut",
    points: [
      [1.4, 1.5],
      [1.9, 1.5],
      [1.9, 3.5],
      [1.4, 3.5],
    ],
  };
  assert.throws(() => buildBodies([holed, slot, simple]), /cross a hole/);
  const shelf = { ...slot, amount: 11.75 };
  assert.throws(() => buildBodies([holed, shelf, simple]), /break through/);
  const arcSettings = {
    ...cfg,
    layout: "arc",
    offset: "0 mm",
    angleStep: "7.5 deg",
    angleSpan: "180 deg",
    length: "60 mm",
    width: "30 mm",
    thickness: "2 mm",
    depth: "0.3 mm",
    appliedId: undefined,
    attachment: undefined,
  };
  const arc = withScaleModel(
    { ...seeds, workspaces: { scale: arcSettings } },
    values,
  );
  const arcFeature = evaluateScaleStock(arc, values, arc.features.at(-1));
  assert.equal(arcFeature.ruler.ticks.length, 25);
  const arcSheet = makeScale(getScaleLayout(arcSettings, values)).preview;
  assert.match(svgFile(arcSheet), /M0 30A30 30 0 0 1 60 30Z/);
  assert.match(dxfFile(arcSheet), /42\r\n-1\r\n10\r\n60/);
  const arcBodies = buildBodies([arcFeature]);
  try {
    assert.ok(measureVolume(arcBodies[0].shape) < 0.5 * Math.PI * 30 ** 2 * 2);
  } finally {
    releaseBodies(arcBodies);
  }
  assert.throws(
    () =>
      withScaleAttachment(
        { ...seeds, workspaces: { scale: { ...cfg, weight: "1.5 mm" } } },
        values,
        cfg.attachment,
      ),
    /overlap/,
  );
  console.log(
    "Passed metric, imperial, decimal and architectural spacing, dual label styles, arc stock, six face placements, named updates, missing material and breakthrough checks.",
  );
} finally {
  await server.close();
}
