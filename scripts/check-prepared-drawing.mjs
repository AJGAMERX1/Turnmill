import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
setOC(
  await init({
    wasmBinary: await readFile(
      new URL(import.meta.resolve("replicad-opencascadejs/wasm")),
    ),
  }),
);
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const { prepareDrawing } = await server.ssrLoadModule(
    "/src/preparedDrawing.ts",
  );
  const { buildBodies, releaseBodies } =
    await server.ssrLoadModule("/src/geometry.ts");
  const { projectSolid } = await server.ssrLoadModule(
    "/src/secondaryProjection.ts",
  );
  const { defaultJoint } = await server.ssrLoadModule("/src/kinematics.ts");
  const features = [
    {
      id: "tube",
      name: "Hollow tube",
      kind: "revolve",
      operation: "new",
      amount: 360,
      points: [
        [0, 2],
        [0, 4],
        [12, 4],
        [12, 2],
      ],
    },
  ];
  const input = { features, values: {}, modeled: true };
  const prepared = prepareDrawing(input),
    bodies = buildBodies(features);
  try {
    for (const spec of [
      { axis: "X", offset: 3 },
      { axis: "Y", offset: 1 },
      { axis: "Z", offset: -1 },
    ]) {
      const original = projectSolid(bodies[0].shape, bodies[0].shape, spec),
        cut = prepared.cut(spec).part;
      assert.equal(original.sectionStation, cut.sectionStation);
      assert.deepEqual(original.views.section, cut.section);
      for (const name of ["front", "top", "right", "iso"])
        assert.deepEqual(original.views[name], prepared.base.part.views[name]);
    }
    assert.throws(() => prepared.cut({ axis: "X", offset: 55 }), /outside/);
    assert.equal(prepared.cut({ axis: "X", offset: 0 }).part.sectionStation, 6);
  } finally {
    prepared.dispose();
    releaseBodies(bodies);
  }
  const assembly = prepareDrawing({
    ...input,
    features: [...features, { ...features[0], id: "second" }],
    joints: {
      second: { ...defaultJoint(), parent: "tube", offset: ["20", "0", "0"] },
    },
  });
  try {
    assert.deepEqual(
      assembly.base.assembly.parts.map((p) => p.id),
      ["tube", "second"],
    );
    assert.equal(assembly.cut().assembly, undefined);
    assert.deepEqual(
      assembly.cut({ axis: "Y", offset: 0 }).assembly.parts.map((p) => p.id),
      ["tube", "second"],
    );
    assert.deepEqual(
      assembly.cut({ axis: "X", offset: 10 }).assembly.parts.map((p) => p.id),
      ["second"],
    );
    assert.throws(() => assembly.cut({ axis: "X", offset: 0 }), /misses/);
  } finally {
    assembly.dispose();
  }
  console.log(
    "PASS exact reusable orthographic views, all section planes, offset assembly and correction after invalid section.",
  );
} finally {
  await server.close();
}
