import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { setOC, measureVolume } from "replicad";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
const sampleDir = process.argv[2];
if (sampleDir) await mkdir(sampleDir, { recursive: true });

try {
  setOC(
    await initOC({
      wasmBinary: await readFile(
        new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
      ),
    }),
  );
  const { evaluateFinish } = await server.ssrLoadModule(
    "/src/finishingTypes.ts",
  );
  const { buildBodies, releaseBodies, exportBodies } =
    await server.ssrLoadModule("/src/geometry.ts");
  const params = { pitch: 8 };
  const stock = {
    id: "plate",
    name: "Plate",
    kind: "extrude",
    operation: "new",
    amount: 12,
    points: [
      [0, 0],
      [24, 0],
      [24, 20],
      [0, 20],
    ],
  };
  const blank = {
    id: "blank",
    name: "Turned blank",
    kind: "revolve",
    operation: "new",
    amount: 360,
    points: [
      [0, 0],
      [0, 10],
      [24, 10],
      [24, 0],
    ],
  };
  const common = {
    id: "hole",
    name: "Test hole",
    kind: "hole",
    end: "start",
    diameter: "pitch / 2",
    length: "8 mm",
    termination: "blind",
    profile: "straight",
    offsetU: "3 mm",
    offsetV: "-2 mm",
  };
  const annulus = Math.PI * (16 - 4);
  const seatConeExtra = (Math.PI * 2 * (16 + 8 + 4)) / 3 - 2 * Math.PI * 4;

  async function verify(name, feature, source, removed, entries) {
    const finish = evaluateFinish(source, params);
    const bodies = buildBodies([
      { ...feature, finishes: [...(feature.finishes ?? []), finish] },
    ]);
    try {
      const shape = bodies[0].shape;
      const capacity =
        feature.kind === "extrude" ? 24 * 20 * 12 : Math.PI * 100 * 24;
      assert.ok(
        Math.abs(capacity - measureVolume(shape) - removed) < 1e-5,
        name + " removed incorrect volume",
      );
      const faces = shape.faces;
      try {
        for (const [type, minAxis, maxAxis] of entries) {
          assert.ok(
            faces.some((f) => {
              if (f.geomType !== type) return false;
              const box = f.boundingBox;
              try {
                const [lo, hi] = box.bounds,
                  a = feature.kind === "extrude" ? 2 : 0;
                return (
                  Math.abs(lo[a] - minAxis) < 1e-4 &&
                  Math.abs(hi[a] - maxAxis) < 1e-4
                );
              } finally {
                box.delete();
              }
            }),
            name + ": missing " + type + " surface at expected stations",
          );
        }
      } finally {
        faces.forEach((f) => f.delete());
      }
      const file = await exportBodies(bodies, "step").text();
      assert.match(file, /MANIFOLD_SOLID_BREP/);
      if (sampleDir) await writeFile(join(sampleDir, name + ".step"), file);
    } finally {
      releaseBodies(bodies);
    }
  }
  await verify("off-center-blind", stock, common, Math.PI * 4 * 8, [
    ["CYLINDRE", 0, 8],
  ]);
  await verify(
    "reverse-counterbore",
    stock,
    {
      ...common,
      end: "end",
      termination: "through",
      profile: "counterbore",
      length: "unused_length",
      seatDiameter: "8 mm",
      seatDepth: "2 mm",
      seatAngle: "unused_angle",
    },
    Math.PI * 4 * 12 + annulus * 2,
    [
      ["CYLINDRE", 10, 12],
      ["CYLINDRE", 0, 10],
    ],
  );
  const priorPilot = evaluateFinish(
    { ...common, termination: "through" },
    params,
  );
  await verify(
    "add-seat-to-pilot",
    { ...stock, finishes: [priorPilot] },
    {
      ...common,
      termination: "through",
      profile: "counterbore",
      seatDiameter: "8",
      seatDepth: "2",
    },
    Math.PI * 4 * 12 + annulus * 2,
    [
      ["CYLINDRE", 0, 2],
      ["CYLINDRE", 2, 12],
    ],
  );
  await verify(
    "reverse-countersink",
    blank,
    {
      ...common,
      end: "end",
      profile: "countersink",
      seatDiameter: "pitch",
      seatAngle: "45 deg * 2",
      seatDepth: "unused_depth",
    },
    Math.PI * 4 * 8 + seatConeExtra,
    [
      ["CONE", 22, 24],
      ["CYLINDRE", 16, 22],
    ],
  );
  await verify(
    "through-countersink",
    stock,
    {
      ...common,
      termination: "through",
      profile: "countersink",
      seatDiameter: "8",
      seatAngle: "90 deg",
    },
    Math.PI * 4 * 12 + seatConeExtra,
    [
      ["CONE", 0, 2],
      ["CYLINDRE", 2, 12],
    ],
  );
  await verify(
    "legacy-centered",
    stock,
    {
      id: "old",
      name: "Old hole",
      kind: "hole",
      end: "start",
      diameter: "4",
      length: "18",
    },
    Math.PI * 4 * 12,
    [["CYLINDRE", 0, 12]],
  );
  function bad(input, re) {
    assert.throws(() => {
      const b = buildBodies([
        {
          ...stock,
          finishes: [evaluateFinish({ ...common, ...input }, params)],
        },
      ]);
      releaseBodies(b);
    }, re);
  }
  bad({ offsetU: "30" }, /misses/);
  bad({ offsetU: "11" }, /breaks out/);
  bad({ length: "12" }, /blind depth/);
  bad(
    { profile: "counterbore", seatDiameter: "3 mm", seatDepth: "1" },
    /larger/,
  );
  bad(
    { profile: "counterbore", seatDiameter: "8 mm", seatDepth: "8 mm" },
    /bottom/,
  );
  bad(
    { profile: "countersink", seatDiameter: "8 mm", seatAngle: "180 deg" },
    /angle/,
  );
  bad(
    {
      profile: "countersink",
      seatDiameter: "8 mm",
      seatAngle: "2 deg",
      termination: "through",
    },
    /available drill depth/,
  );
  console.log(
    "Passed offset blind/through holes, counterbore and countersink entry planes on X and Z, exact removed volumes, STEP solids, legacy replay, and rejected bad cuts.",
  );
} finally {
  await server.close();
}
