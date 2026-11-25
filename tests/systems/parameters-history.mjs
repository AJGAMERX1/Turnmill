import assert from "node:assert/strict";
import {
  runtime,
  project,
  boxSketch,
  feature,
  measureProject,
  save,
  near,
} from "./runtime.mjs";
const api = await runtime();
const { evaluate, resolveParameters } = await api.load("expressions"),
  { validateProject } = await api.load("projects"),
  { threadPresets } = await api.load("finishingTypes");
const { screwLead, buildPoses, defaultJoint } = await api.load("kinematics"),
  { fitLimits } = await api.load("secondaryAssembly");
const grid = [];
async function check(name, fn) {
  const measured = await fn();
  grid.push({ name, outcome: "Pass", measured });
}
try {
  const p = project(
    [boxSketch("outer", 0, 0, "span", 8), boxSketch("cutter", 2, 2, 4, 4)],
    [
      feature("stock", "outer", 4),
      { ...feature("cut", "cutter", 2), operation: "cut", bodyId: "stock" },
    ],
    { parameters: [{ name: "span", expression: "16 mm" }] },
  );
  const base = await measureProject(api, p);
  near(base[0].volume, 504, 0.504, "initial");
  await check("driving length edited and restored exactly", async () => {
    p.parameters[0].expression = "12 mm";
    const [changed] = await measureProject(api, p);
    near(changed.volume, 376, 0.376, "edited");
    p.parameters[0].expression = "16 mm";
    assert.deepEqual(await measureProject(api, p), base);
    return [base[0].volume, changed.volume, base[0].volume];
  });
  await check("suppression/deletion and restore", async () => {
    const missing = structuredClone(p);
    missing.features[1].suppressed = true;
    const [before] = await measureProject(api, missing);
    near(before.volume, 512, 0.512, "suppressed cutter");
    missing.features.pop();
    assert.deepEqual((await measureProject(api, missing))[0], before);
    return before.volume;
  });
  await check(
    "wrong upstream order or suppressed stock gives error",
    async () => {
      const reverse = { ...p, features: [...p.features].reverse() };
      await assert.rejects(
        measureProject(api, reverse),
        /original body earlier/,
      );
      const suppressed = structuredClone(p);
      suppressed.features[0].suppressed = true;
      await assert.rejects(
        measureProject(api, suppressed),
        /original body earlier/,
      );
      return "rejected both";
    },
  );
  await check(
    "names and nongeometric metadata survive portable round-trip",
    async () => {
      const fixture = structuredClone(p);
      fixture.name = "𓃠 ✒️ long project " + "é".repeat(300);
      fixture.features[0].name = "First part ⇄";
      fixture.workspaces = {
        drawing: {
          sources: { "body:stock": { title: "長いルーラー", number: "QA-1" } },
        },
      };
      const restored = validateProject(JSON.parse(JSON.stringify(fixture)));
      assert.deepEqual(restored, fixture);
      const [after] = await measureProject(api, restored);
      near(after.volume, 504, 0.504, "label-only edit");
      return fixture.name.length;
    },
  );
  await check(
    "reject cyclical expression and mixed angles/lengths",
    async () => {
      assert.throws(
        () =>
          resolveParameters([
            { name: "a", expression: "b" },
            { name: "b", expression: "a" },
          ]),
        /Circular/,
      );
      assert.throws(() => evaluate("3 mm + 45 deg", {}), /matching units/);
      return "rejected both";
    },
  );
  await check(
    "independent published ISO pitch and common fit cases",
    async () => {
      const sources = [
        "https://www.guhring.com.tw/upload/Cb%2B_coating_taps.pdf",
        "https://www.guhring.com.mx/pdf/download?path=%2Fsite%2Fgenerals%2Fcat_technical.pdf",
        "https://www.schaeffler.it/remotemedien/media/_shared_media/08_media_library/01_publications/schaeffler_2/catalogue_1/downloads_6/hg_1_de_en.pdf",
      ];
      const rows = [];
      for (const [diameter, pitch] of [
        [5, 0.8],
        [10, 0.75],
      ]) {
        const preset = threadPresets.find(
          (t) => t.label === "M" + diameter + " × " + pitch,
        );
        assert(preset);
        const p = evaluate(preset.pitch, {}),
          d = evaluate(preset.diameter, {});
        near(p, pitch, 0.01, "nominal pitch");
        near(d, diameter, 0.01, "nominal diameter");
        const joint = {
          ...defaultJoint(),
          kind: "screw",
          pitch: preset.pitch,
          starts: "1",
          max: "720 deg",
        };
        const transform = buildPoses(
          ["fastener"],
          { fastener: joint },
          { fastener: [360] },
          {},
        );
        near(transform[0][12], pitch, 0.01, "one-turn advance");
        rows.push({
          diameter: d,
          pitch: p,
          travelPerTurn: screwLead(joint, {}),
        });
      }
      const fit = fitLimits(10, "H7/g6");
      near(fit.shaftMax, 9.995, 1e-9, "g6 major limit");
      near(fit.shaftMin, 9.986, 1e-9, "g6 minor limit");
      near(fit.holeMin, 10, 1e-9, "H7 min");
      near(fit.holeMax, 10.015, 1e-9, "H7 max");
      near(fit.min, 0.005, 1e-9, "minimum clearance");
      near(fit.max, 0.029, 1e-9, "maximum clearance");
      return { sources, parts: rows, fit };
    },
  );
  const f = {
    ...feature("plate", "stock", 2),
    finishes: [
      {
        id: "mark",
        name: "Text engraving",
        end: "start",
        kind: "mark",
        content: "text",
        text: "A",
        method: "engrave",
        height: "2",
        depth: "0.2",
        offset: "2",
        rotation: "0 deg",
      },
    ],
  };
  const mark = project([boxSketch("stock", 0, 0, 10, 4)], [f]);
  await check("oversized text rejected", async () => {
    mark.features[0].finishes[0].height = "22";
    await assert.rejects(measureProject(api, mark), /fit|reduce/i);
    return "rejected";
  });
  mark.features[0].finishes[0].height = "2";
  mark.features[0].finishes[0].depth = "3 mm";
  await check("through-cut A leaves an unsupported island", async () => {
    await assert.rejects(measureProject(api, mark), /one connected body/);
    return "Rejected separate island in letter A";
  });
  mark.features[0].finishes[0].text = "I";
  const [through] = await measureProject(api, mark);
  await save("deep-engraving-observation.json", {
    stockThickness: 2,
    requested: 3,
    valid: through.valid,
    cutRemoved: 80 - through.volume,
    observed:
      "Letter I through-cut accepted on 2 mm stock; the model stores the requested cutter travel, depth 3 mm. No warning in geometry response.",
    classification:
      "Record behavior; no contract requiring all-purpose engraving to reject a through-cut.",
  });
  const rect = [
    [0, -0.5],
    [1, -0.5],
    [1, 0.5],
    [0, 0.5],
  ];
  const artwork = {
    width: 1,
    outlines: [
      { outer: rect.map((v, i) => [v, rect[(i + 1) % 4]]), holes: [] },
    ],
  };
  const placements = [];
  for (const end of ["start", "end"]) {
    const f = {
      ...feature("plate", "stock", 2),
      finishes: [
        {
          id: "graphic",
          name: "Square",
          kind: "mark",
          end,
          content: "graphic",
          method: "engrave",
          text: "",
          artwork,
          height: "2",
          depth: "0.2",
          offset: "1",
          rotation: "0 deg",
        },
      ],
    };
    const doc = project([boxSketch("stock", 0, 0, 10, 4)], [f]);
    await save("SYS-005/" + end + ".turnmill", doc);
    const [m] = await measureProject(api, doc);
    const baseVolume = 80,
      removed = baseVolume - m.volume;
    const removedCenter = [5, 2, 1].map(
      (n, i) => (baseVolume * n - m.volume * m.center[i]) / removed,
    );
    near(removed, 0.8, 0.0008, "square cut");
    near(
      removedCenter[0],
      end === "start" ? 2 : 8,
      0.01,
      "square changes along X",
    );
    near(removedCenter[2], 1.9, 0.01, "same top face for both end choices");
    placements.push({ end, removed, removedCenter });
  }
  await save("SYS-005/measurements.json", placements);
  console.log(
    "PASS",
    grid.length,
    "parameter, history, exchange name, published fit/pitch, and oversize artwork checks.",
  );
} finally {
  await save("parameter-history.json", grid);
  await api.close();
}
