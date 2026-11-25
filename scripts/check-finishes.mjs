import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { measureShapeVolumeProperties, measureVolume, setOC } from "replicad";

const wasmBinary = await readFile(
  new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
);
setOC(await initOC({ wasmBinary }));
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { buildBodies, exportBodies, releaseBodies } =
    await server.ssrLoadModule("/src/geometry.ts");
  const { importSolidFile } = await server.ssrLoadModule(
    "/src/exchangeSolids.ts",
  );
  const { evaluateFinish } = await server.ssrLoadModule(
    "/src/finishingTypes.ts",
  );
  const { projectSolid } = await server.ssrLoadModule(
    "/src/secondaryProjection.ts",
  );
  const { manufacturingSheets } = await server.ssrLoadModule(
    "/src/secondaryManufacturing.ts",
  );
  // Optional retained STEP files can be opened in another CAD system for inspection.
  const stepDirectory = process.env.TURNMILL_TEST_STEP_DIR;
  if (stepDirectory) await mkdir(stepDirectory, { recursive: true });

  const tube = {
    id: "tube",
    name: "Tube",
    kind: "revolve",
    operation: "new",
    amount: 360,
    points: [
      [0, 3],
      [0, 5],
      [12, 5],
      [12, 3],
    ],
  };
  const plate = {
    id: "plate",
    name: "Plate",
    kind: "extrude",
    operation: "new",
    amount: 8,
    points: [
      [0, 0],
      [20, 0],
      [20, 15],
      [0, 15],
    ],
  };
  const tubeVolume = Math.PI * (25 - 9) * 12;
  const plateVolume = 20 * 15 * 8;
  const drawing = {
    title: "Fixture",
    number: "",
    revision: "",
    material: "",
    note: "",
    scale: "auto",
    dimensions: true,
    hatch: false,
    measures: [],
  };

  function close(actual, expected, tolerance = 1e-5) {
    assert.ok(
      Math.abs(actual - expected) <= tolerance,
      `Expected ${expected} ± ${tolerance}, got ${actual}`,
    );
  }

  async function verify(name, stock, settings, check, callouts = []) {
    const finish = evaluateFinish(
      { id: name, name, end: "end", ...settings },
      { drill: 4, pitch: 0.75 },
    );
    const feature = { ...stock, finishes: [finish] };
    const bodies = buildBodies([feature]);
    try {
      assert.equal(bodies.length, 1);
      const { shape, guides } = bodies[0];
      const volume = measureVolume(shape);
      check(volume, shape, guides);
      if (callouts.length) {
        const { sheets } = manufacturingSheets(
          projectSolid(shape),
          drawing,
          [feature],
          "",
        );
        const labels = sheets.flatMap(({ sheet }) =>
          sheet.marks.filter((m) => m.type === "text").map((m) => m.value),
        );
        for (const callout of callouts)
          assert.ok(
            labels.includes(callout),
            `Missing drawing callout: ${callout}`,
          );
      }
      const step = exportBodies(bodies, "step");
      if (stepDirectory)
        await writeFile(
          join(stepDirectory, name + ".step"),
          Buffer.from(await step.arrayBuffer()),
        );
      const imported = await importSolidFile("step", step, name);
      try {
        assert.equal(
          imported.length,
          1,
          "One solid must survive STEP transfer",
        );
        close(measureVolume(imported[0].shape), volume, 0.002);
      } finally {
        releaseBodies(imported);
      }
      console.log("PASS", name);
    } catch (cause) {
      throw new Error(`Finish check failed for ${name}`, { cause });
    } finally {
      releaseBodies(bodies);
    }
  }

  const rim = { size: "0.35 mm", rims: "outer" };
  await verify("outer-fillet", tube, { kind: "fillet", ...rim }, (volume) => {
    assert.ok(volume < tubeVolume - 0.1 && volume > tubeVolume - 3);
  });
  const chamfer = 0.35;
  const chamferCut = Math.PI * (5 * chamfer ** 2 - chamfer ** 3 / 3);
  await verify("outer-chamfer", tube, { kind: "chamfer", ...rim }, (volume) => {
    close(volume, tubeVolume - chamferCut);
  });
  await verify(
    "suppressed-chamfer",
    tube,
    { kind: "chamfer", ...rim, suppressed: true },
    (volume) => {
      close(volume, tubeVolume);
    },
  );

  const pilot = { kind: "hole", diameter: "drill", length: "drill + 1 mm" };
  await verify(
    "legacy-hole",
    tube,
    { ...pilot, diameter: "7", length: "4" },
    (volume) => {
      close(volume, tubeVolume - Math.PI * (3.5 ** 2 - 3 ** 2) * 4);
    },
    [
      "Hole 1 · Ø 7 · drill travel 4 · from X max",
      "Hole 1 center · Y 0, Z 0 from the turning axis",
    ],
  );

  const offsetHole = {
    ...pilot,
    offsetU: "3",
    offsetV: "-1",
    seatDiameter: "drill * 2",
  };
  const xy = "Hole 1 center · X 3, Y -1 from the stock bounds center";
  const cylinderVolume = Math.PI * 2 ** 2;
  await verify(
    "through-counterbore",
    plate,
    {
      ...offsetHole,
      termination: "through",
      profile: "counterbore",
      seatDepth: "2",
      length: "",
    },
    (volume, shape) => {
      const through = cylinderVolume * 8;
      const recess = Math.PI * (4 ** 2 - 2 ** 2) * 2;
      close(volume, plateVolume - through - recess);
      // Only the high end is counterbored. Verify all three center coordinates.
      const mass = measureShapeVolumeProperties(shape);
      try {
        const [x, y, z] = mass.centerOfMass;
        close(x, (plateVolume * 10 - (through + recess) * 13) / volume);
        close(y, (plateVolume * 7.5 - (through + recess) * 6.5) / volume);
        close(z, (plateVolume * 4 - through * 4 - recess * 7) / volume);
      } finally {
        mass.delete();
      }
    },
    ["Hole 1 · Ø 4 THRU · from Z max", "Hole 1 · Counterbore Ø 8 × 2 deep", xy],
  );
  await verify(
    "blind-countersink",
    plate,
    {
      ...offsetHole,
      end: "start",
      termination: "blind",
      profile: "countersink",
      seatAngle: "90 deg",
    },
    (volume) => {
      const frustum = (Math.PI * 2 * (4 ** 2 + 4 * 2 + 2 ** 2)) / 3;
      close(volume, plateVolume - frustum - cylinderVolume * 3);
    },
    [
      "Hole 1 · Ø 4 × 5 deep · from Z min",
      "Hole 1 · Countersink Ø 8 × 90° included",
      xy,
    ],
  );

  const thread = {
    kind: "thread",
    diameter: "10",
    length: "6 * pitch",
    pitch: "pitch",
    preset: "Custom",
    side: "external",
    hand: "right",
    mode: "modeled",
  };
  await verify(
    "cosmetic-thread",
    tube,
    { ...thread, mode: "cosmetic" },
    (volume, shape, guides) => {
      close(volume, tubeVolume);
      assert.ok(guides?.[0]?.length > 6, "Display the cosmetic helix");
    },
  );
  await verify("external-thread", tube, thread, (volume) =>
    assert.ok(volume < tubeVolume - 1),
  );
  await verify(
    "internal-thread",
    tube,
    { ...thread, side: "internal", diameter: "7.5", hand: "left" },
    (volume) => assert.ok(volume < tubeVolume - 1),
  );

  const knurl = {
    kind: "knurl",
    end: "start",
    diameter: "10",
    length: "4",
    depth: "0.25",
    offset: "2",
    count: "8",
    angle: "30 deg",
  };
  let straightVolume;
  await verify(
    "straight-knurl",
    tube,
    { ...knurl, style: "straight" },
    (volume) => {
      assert.ok(volume < tubeVolume - 0.1);
      straightVolume = volume;
    },
  );
  await verify(
    "diamond-knurl",
    tube,
    { ...knurl, style: "diamond" },
    (volume) => {
      assert.ok(
        volume < straightVolume - 0.1,
        "Cross-cutting must remove both families of grooves",
      );
    },
  );

  function rectangle(x, y, w, h) {
    const points = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    return points.map((p, i) => [p, points[(i + 1) % 4]]);
  }
  // Normalized filled graphic with an unfilled island, as saved in a project.
  const artwork = {
    width: 1,
    outlines: [
      {
        outer: rectangle(0, -0.5, 1, 1),
        holes: [rectangle(0.25, -0.25, 0.5, 0.5)],
      },
    ],
  };
  const mark = {
    kind: "mark",
    end: "start",
    height: "2 mm",
    depth: "0.2",
    offset: "3",
    rotation: "0 deg",
  };
  for (const [surface, stock, base] of [
    ["flat", plate, plateVolume],
    ["cylindrical", tube, tubeVolume],
  ]) {
    for (const method of ["engrave", "emboss"]) {
      for (const content of ["graphic", "text"]) {
        await verify(
          `${surface}-${method}-${content}`,
          stock,
          { ...mark, content, method, text: "P", artwork },
          (volume) => {
            const change = (volume - base) * (method === "engrave" ? -1 : 1);
            assert.ok(change > 0.02);
            if (surface === "flat" && content === "graphic")
              close(change, (4 - 1) * 0.2);
          },
        );
      }
    }
  }
} finally {
  await server.close();
}
