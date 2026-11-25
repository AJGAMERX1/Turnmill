import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { makeBox, setOC } from "replicad";
import { Matrix4 } from "three";

const solver = "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  plugins: [
    {
      name: "node-solver-wasm",
      enforce: "pre",
      resolveId(id) {
        if (id === solver + "?url") return "virtual:assembly-solver-wasm";
      },
      load(id) {
        if (id === "virtual:assembly-solver-wasm")
          return (
            "export default " +
            JSON.stringify(fileURLToPath(import.meta.resolve(solver)))
          );
      },
    },
  ],
});
const drawing = {
  title: "Twist pen assembly",
  revision: "A",
  number: "PEN-ASM-01",
  material: "See parts list",
  note: "",
  scale: "auto",
  dimensions: true,
  hatch: true,
  measures: [],
};
const close = (a, b, epsilon = 1e-6) =>
  assert(Math.abs(a - b) < epsilon, `Expected ${a} to equal ${b}`);
function assertSeparation(parts, gap) {
  for (let i = 0; i < parts.length; i++)
    for (const b of parts.slice(i + 1)) {
      const a = parts[i];
      const separation = Math.max(
        ...[0, 1].flatMap((k) => [
          b.bounds[0][k] - a.bounds[1][k],
          a.bounds[0][k] - b.bounds[1][k],
        ]),
      );
      assert(
        separation >= gap - 1e-6,
        "Adjacent exploded components have the requested drawing gap",
      );
    }
}

try {
  setOC(
    await initOC({
      wasmBinary: await readFile(
        new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
      ),
    }),
  );
  const load = (name) => server.ssrLoadModule("/src/" + name);
  const { projectAssemblyDrawing, isoNormal, isoRight } = await load(
    "assemblyDrawingProjection.ts",
  );
  const { explodeAssembly } = await load("assemblyExplosion.ts");
  const { projectView, cutAssemblySection } = await load(
    "secondaryProjection.ts",
  );
  const { assemblySheets } = await load("secondaryAssemblySheet.ts");
  const { positioned } = await load("motionGeometry.ts");
  const { defaultJoint, buildPoses, bodyIds } = await load("kinematics.ts");
  const { assemblyItemNumbers, keepAssemblyItems } =
    await load("assemblyItems.ts");
  const { assemblyParts, bomCsv } = await load("AssemblyBom.tsx");
  const { validateProject } = await load("projects.ts");
  const portable = validateProject(
    JSON.parse(
      await readFile(
        new URL("../examples/twist-pen.turnmill", import.meta.url),
        "utf8",
      ),
    ),
  );
  const ids = portable.features.map((f) => f.id);
  const initial = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
  assert.deepEqual(
    assemblyItemNumbers(portable),
    initial,
    "Legacy files start with feature-order numbers",
  );
  const changed = keepAssemblyItems(portable, {
    ...portable,
    features: portable.features
      .slice()
      .reverse()
      .map((f) => ({ ...f, suppressed: f.id === ids[1] })),
  });
  assert.deepEqual(assemblyItemNumbers(changed), initial);
  const remaining = changed.features.filter((f) => f.id !== ids[1]);
  const removed = keepAssemblyItems(changed, {
    ...changed,
    features: remaining,
  });
  const added = keepAssemblyItems(removed, {
    ...removed,
    features: [...remaining, { ...remaining[0], id: "replacement" }],
  });
  assert.deepEqual(assemblyItemNumbers(added), { ...initial, replacement: 5 });
  const reopened = validateProject(JSON.parse(JSON.stringify(added)));
  assert.deepEqual(assemblyItemNumbers(reopened), assemblyItemNumbers(added));
  assert.deepEqual(
    assemblyItemNumbers(changed),
    initial,
    "Restoring the prior journal snapshot restores item identities",
  );

  const names = ["Base", "Sleeve", "Sleeve"],
    fixtureIds = ["base", "shaft", "ring"];
  const fixtures = [
    makeBox([-4, -3, -2], [4, 3, 2]),
    makeBox([0, -1, -1], [13, 1, 1]),
    makeBox([2, -2, -1], [5, 2, 1]),
  ];
  const jointConfig = {
    base: {
      ...defaultJoint(),
      offset: ["12", "5", "2"],
      mount: new Matrix4().makeRotationZ(Math.PI / 2).toArray(),
    },
    shaft: {
      ...defaultJoint(),
      kind: "slider",
      parent: "base",
      axis: "X",
      offset: ["3", "0", "0"],
    },
    ring: {
      ...defaultJoint(),
      kind: "fixed",
      parent: "shaft",
      offset: ["5", "0", "0"],
    },
  };
  const matrices = buildPoses(fixtureIds, jointConfig, {}, {}),
    placed = fixtures.map((s, i) => positioned(s, matrices[i]));
  try {
    const projection = projectAssemblyDrawing(
      placed,
      fixtureIds,
      names,
      jointConfig,
      matrices,
      false,
    );
    assert.deepEqual(
      projection.dimensions.map((v) => Math.round(v)),
      [6, 20, 4],
      "Assembled bounds include rotated home transforms",
    );
    const exactBase = placed[0].clone().translate(0, 0, 10);
    try {
      const alternate = projectAssemblyDrawing(
        placed,
        fixtureIds,
        names,
        jointConfig,
        matrices,
        true,
        [exactBase, ...placed.slice(1)],
      );
      close(alternate.dimensions[2], 13);
      assert.deepEqual(
        alternate.views,
        projection.views,
        "Simplifying the display leaves measurements attached to real B-rep extrema",
      );
    } finally {
      exactBase.delete();
    }
    close(projection.parts[1].axis[0], 0);
    close(projection.parts[1].axis[1], 1);
    for (const axis of ["joints", "X", "Y", "Z"]) {
      const exploded = explodeAssembly(projection.parts, { axis, gap: 3 });
      assertSeparation(exploded, 3);
      for (let i = 0; i < exploded.length; i++) {
        const p = exploded[i],
          physical = placed[i].clone().translate(...p.offset);
        try {
          const rerun = projectView(physical, isoNormal, isoRight);
          for (const j of [0, 1])
            for (const k of [0, 1]) close(p.bounds[j][k], rerun.bounds[j][k]);
        } finally {
          physical.delete();
        }
      }
    }
    assert.throws(
      () => explodeAssembly(projection.parts, { gap: 0 }),
      /positive length/,
    );
    const fixtureRows = fixtureIds.map((id, i) => ({
      bodyId: id,
      item: [1, 4, 7][i],
      name: names[i],
      quantity: 1,
      material: "Brass",
      source: "Modeled part",
      specification: "",
      joint: jointConfig[id].kind,
      parent: i ? names[i - 1] : "Ground",
    }));
    const sheets = assemblySheets(projection, drawing, fixtureRows);
    assert.deepEqual(
      sheets.map((s) => s.label),
      ["Assembly views", "Exploded assembly", "Bill of materials"],
    );
    assert.deepEqual(
      sheets[1].sheet.marks
        .filter((m) => m.layer === "Balloons" && m.type === "text")
        .map((m) => m.value),
      ["1", "4", "7"],
    );
    assert.equal(
      sheets[1].sheet.marks.filter(
        (m) => m.layer === "Balloons" && m.type === "path",
      ).length,
      3,
      "Every numbered balloon has a leader",
    );
    assert(
      sheets[0].sheet.marks.some(
        (m) =>
          m.layer === "Dimensions" && m.type === "text" && m.value === "20",
      ),
    );
    assert(
      !assemblySheets(
        projection,
        { ...drawing, dimensions: false },
        fixtureRows,
      )[0].sheet.marks.some((m) => m.layer === "Dimensions"),
    );
    assert.throws(
      () => assemblySheets(projection, drawing, fixtureRows.slice(1)),
      /parts list has changed/,
    );
    assert.throws(
      () => assemblySheets(projection, { ...drawing, scale: 100 }, fixtureRows),
      /smaller drawing scale/,
    );
    const many = Array.from({ length: 31 }, (_, i) => ({
      ...projection.parts[0],
      id: "body-" + i,
      parent: i ? "body-0" : "",
    }));
    const rows = many.map((p, i) => ({
      ...fixtureRows[0],
      bodyId: p.id,
      item: 1 + i,
      name: "Component " + i,
    }));
    const packet = assemblySheets(
      { ...projection, parts: many },
      drawing,
      rows,
    );
    assert.equal(
      packet.length,
      7,
      "31 parts paginate into one home, four explosion and two BOM sheets",
    );
    const balloonIds = packet
      .filter((s) => s.label.startsWith("Exploded"))
      .flatMap((s) =>
        s.sheet.marks
          .filter((m) => m.type === "text" && m.layer === "Balloons")
          .map((m) => Number(m.value)),
      );
    assert.deepEqual(
      balloonIds,
      rows.map((r) => r.item),
    );
  } finally {
    [...placed, ...fixtures].forEach((s) => s.delete());
  }

  const neighbors = [
    makeBox([-6, -5, -2], [0, 5, 2]),
    makeBox([0, -5, -2], [6, 5, 2]),
  ];
  try {
    const ids = ["left", "right"],
      names = ["Left jaw", "Right jaw"],
      home = ids.map(() => new Matrix4().toArray());
    const geometry = projectAssemblyDrawing(
      neighbors,
      ids,
      names,
      {},
      home,
      false,
    );
    const section = cutAssemblySection(neighbors, ids, geometry.bounds, {
      axis: "Z",
      offset: 0.25,
    });
    const rows = ids.map((id, i) => ({
      bodyId: id,
      item: i + 1,
      name: names[i],
      quantity: 1,
      material: "Brass",
      joint: "fixed",
      parent: "Ground",
      source: "Modeled part",
      specification: "",
    }));
    const packet = assemblySheets(geometry, drawing, rows, {
      section,
      detail: { end: "end", width: 4 },
    });
    assert.deepEqual(
      packet.map((s) => s.label),
      [
        "Assembly views",
        "Assembly section A–A",
        "Section detail B",
        "Exploded assembly",
        "Bill of materials",
      ],
    );
    assert(packet[0].sheet.marks.some((m) => m.layer === "Cutting_plane"));
    assert(packet[1].sheet.marks.some((m) => m.layer === "Detail_boundary"));
    assert(
      packet[1].sheet.marks.some(
        (m) => m.type === "text" && m.value.includes("Z = 0.25 mm"),
      ),
    );
    const a = packet[1].sheet.marks.filter(
      (m) => m.layer === "Section_hatch_1" && m.pts[0][1] < 150,
    );
    const b = packet[1].sheet.marks.filter(
      (m) => m.layer === "Section_hatch_2" && m.pts[0][1] < 150,
    );
    assert(a.length && b.length);
    assert(a.every((m) => m.pts.every((p) => p[0] <= 148.5 + 1e-7)));
    assert(
      b.every((m) => m.pts.every((p) => p[0] >= 148.5 - 1e-7)),
      "A coincident interface preserves independent hatching",
    );
    assert(
      a[0].pts[1][1] > a[0].pts[0][1] && b[0].pts[1][1] < b[0].pts[0][1],
      "Adjacent components hatch at opposite inclinations",
    );
    assert(packet[2].sheet.marks.some((m) => m.layer === "Section_item_2"));
    assert(
      !packet[2].sheet.marks.some((m) => m.layer === "Section_item_1"),
      "The clipped detail contains only the requested end",
    );
    assert(packet[2].scale > packet[1].scale);
    const dimension = {
      spec: { id: "span", view: "section", mode: "horizontal" },
      a: [-6, 5],
      b: [6, 5],
      offset: 7,
      value: 12,
      text: "12 ±0.01",
    };
    const dimensioned = assemblySheets(geometry, drawing, rows, {
      section,
      tolerance: "0.05",
      manualDimensions: [dimension],
    });
    assert.equal(dimensioned.at(-1).label, "Section A–A dimensions");
    assert(
      dimensioned
        .at(-1)
        .sheet.marks.some((m) => m.type === "text" && m.value === "12 ±0.01"),
    );
    for (const s of [dimensioned[0], dimensioned[1], dimensioned.at(-1)])
      assert(
        s.sheet.marks.some(
          (m) => m.type === "text" && m.value.includes("± 0.05 mm"),
        ),
      );
    for (const [i, s] of dimensioned.entries())
      assert(
        s.sheet.marks.some(
          (m) =>
            m.type === "text" && m.value === i + 1 + " / " + dimensioned.length,
        ),
      );

    assert.throws(
      () =>
        assemblySheets(geometry, drawing, rows, {
          section,
          detail: { end: "end", width: 40 },
        }),
      /wid/,
    );
  } finally {
    neighbors.forEach((s) => s.delete());
  }

  const { evaluateModel } = await load("buildModel.ts");
  const { buildBodies, releaseBodies } = await load("geometry.ts");
  const { resolveThreadMates } = await load("threadMates.ts");
  const { features, values } = await evaluateModel(portable);
  const cosmetic = features.map((f) => ({
    ...f,
    finishes: f.finishes?.map((g) =>
      g.kind === "thread" ? { ...g, mode: "cosmetic" } : g,
    ),
  }));
  const display = buildBodies(cosmetic);
  const source = process.argv.includes("--modeled")
    ? buildBodies(features)
    : display;
  const home = [],
    exactHome = [];
  try {
    const ids = bodyIds(features),
      joints = resolveThreadMates(
        portable.workspaces.joints,
        source.flatMap((b) => b.threadFrames || []),
        values,
        ids,
      );
    const poses = buildPoses(ids, joints, {}, values);
    display.forEach((b, i) => home.push(positioned(b.shape, poses[i])));
    if (source !== display)
      source.forEach((b, i) => exactHome.push(positioned(b.shape, poses[i])));
    const projection = projectAssemblyDrawing(
      home,
      ids,
      source.map((b) => b.name),
      joints,
      poses,
      true,
      exactHome.length ? exactHome : home,
    );
    const rows = assemblyParts(portable, features);
    assert.deepEqual(
      rows.map((r) => r.name),
      ["Barrel", "Threaded cap", "Refill", "Pocket clip"],
    );
    assert.deepEqual(
      rows.map((r) => r.bodyId),
      ids,
    );
    assert.deepEqual(
      rows.map((r) => r.item),
      [1, 2, 3, 4],
    );
    assert.equal(rows[1].parent, "Barrel");
    const sheets = assemblySheets(projection, drawing, rows);
    assert(
      sheets[1].sheet.marks.some(
        (m) => m.type === "text" && m.value === "Simplified thread outlines",
      ),
    );
    for (const r of rows)
      assert(
        sheets[2].sheet.marks.some(
          (m) => m.type === "text" && m.value === r.name,
        ),
      );
    const revision = {
      ...portable,
      workspaces: {
        ...portable.workspaces,
        bodyMaterials: {
          ...portable.workspaces.bodyMaterials,
          [ids[0]]: "Acetal",
        },
      },
    };
    const revised = assemblyParts(revision, features);
    assert.equal(revised[0].material, "Acetal");
    assert(
      assemblySheets(projection, drawing, revised)[2].sheet.marks.some(
        (m) => m.type === "text" && m.value === "Acetal",
      ),
    );
    assert(
      bomCsv(revised).includes('"1","Barrel","1","fixed","Ground","Acetal"'),
    );
    const section = cutAssemblySection(
      exactHome.length ? exactHome : home,
      ids,
      projection.bounds,
      { axis: "Y", offset: 0 },
    );
    const cutPacket = assemblySheets(projection, drawing, rows, {
      section,
      detail: { width: 18, end: "end" },
    });
    assert(cutPacket[1].sheet.marks.some((m) => m.layer === "Section_item_2"));
    assert(cutPacket[2].sheet.marks.some((m) => m.layer === "Section_item_2"));
    const out = process.env.TURNMILL_DRAWING_PREVIEW;
    if (out) {
      const { svgFile } = await load("secondaryVector.tsx");
      await mkdir(out, { recursive: true });
      for (const [i, s] of cutPacket.entries())
        await writeFile(join(out, `assembly-${i + 1}.svg`), svgFile(s.sheet));
    }
  } finally {
    [...home, ...exactHome].forEach((s) => s.delete());
    if (source !== display) releaseBodies(source);
    releaseBodies(display);
  }
  console.log(
    "Passed assembly home views, four 3D explosion directions, component hatches and detail crops, BOM pagination, and persistent balloon numbers on the twist pen.",
  );
} finally {
  await server.close();
}
