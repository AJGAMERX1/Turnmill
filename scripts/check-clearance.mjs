import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { makeBox, setOC } from "replicad";
import { fileURLToPath } from "node:url";
const solverModule = "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm";
const server = await createServer({
  plugins: [
    {
      name: "local-solver-wasm",
      enforce: "pre",
      resolveId(id) {
        if (id === solverModule + "?url") return "\0local-solver-path";
      },
      load(id) {
        if (id === "\0local-solver-path")
          return (
            "export default " +
            JSON.stringify(fileURLToPath(import.meta.resolve(solverModule)))
          );
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
  const { checkPair } = await server.ssrLoadModule("/src/clearance.ts");
  const { defaultJoint } = await server.ssrLoadModule("/src/kinematics.ts");
  const ids = ["slider", "gate", "guard", "child"];
  const boxes = [
    [
      [0, 0, 0],
      [2, 2, 2],
    ],
    [
      [10, 0, 0],
      [11, 2, 2],
    ],
    [
      [0, 4, 0],
      [2, 6, 2],
    ],
    [
      [3, 0, 0],
      [4, 1, 1],
    ],
  ];
  const bodies = boxes.map(([a, b], i) => ({
    name: ids[i],
    shape: makeBox(a, b),
  }));
  const joint = {
    ...defaultJoint(),
    kind: "slider",
    min: "-2 mm",
    max: "20 mm",
  };
  const base = {
    type: "check",
    version: 1,
    token: 2,
    id: "slider",
    pair: "gate",
    coordinate: 0,
    range: true,
    config: { slider: joint, child: { ...defaultJoint(), parent: "slider" } },
    drivers: {},
    values: {},
  };
  const run = (p) => checkPair(bodies, ids, { ...base, ...p });
  try {
    assert.equal((await run({ range: false })).sampledGap, 8);
    let r = await run({});
    assert.equal(r.status, "interference");
    assert.equal(r.coordinate, 9);
    assert.ok(Math.abs(r.overlap - 4) < 1e-8);
    r = await run({ pair: "guard", requiredGap: 1 });
    assert.equal(r.status, "clear");
    assert.ok(r.lowerBound >= 1 && r.lowerBound <= 2);
    r = await run({ pair: "guard", range: false, requiredGap: 3 });
    assert.equal(r.status, "below-target");
    assert.equal(r.sampledGap, 2);
    r = await run({ pair: "child", requiredGap: 0.9 });
    assert.equal(r.status, "clear");
    assert.equal(r.probes, 1);
    r = await run({ pair: "guard", requiredGap: 1.99, maxProbes: 3 });
    assert.equal(r.status, "unresolved");
    assert.ok(r.lowerBound <= r.sampledGap);
    r = await run({ pair: "gate", range: false, drivers: { slider: [8] } });
    assert.equal(r.status, "contact");
    const touchThenCollide = await run({
      range: true,
      config: { slider: { ...joint, min: "8 mm", max: "10 mm" } },
    });
    assert.equal(touchThenCollide.status, "interference");
    await assert.rejects(() => run({ requiredGap: -1 }), /nonnegative/);
    await assert.rejects(
      () =>
        checkPair(
          bodies,
          ids,
          base,
          () => {},
          () => true,
        ),
      /canceled/,
    );
    console.log(
      "Passed actual-solid pose, interior interference, required clearance, continuous lower bound, stationary descendants, contact, cancellation and limited-budget results.",
    );
  } finally {
    for (const b of bodies) b.shape.delete();
  }
  // A later feature may intrude into a thread. Metadata alone must never certify
  // a mating pair: this off-axis lug hits its stop only at a quarter turn.
  const frames = {
    axis: "X",
    entrance: [0, 0, 0],
    end: "start",
    hand: "right",
    mode: "modeled",
    pitch: 0.75,
    length: 2,
  };
  const lug = makeBox([0, 7, 0], [1, 8, 1]),
    stop = makeBox([0.2, -1, 7], [1.2, 0, 8]);
  const parts = [
    {
      name: "Lug",
      shape: lug,
      threadFrames: [{ ...frames, side: "internal", diameter: 10 }],
    },
    {
      name: "Stop",
      shape: stop,
      threadFrames: [{ ...frames, side: "external", diameter: 9.8 }],
    },
  ];
  try {
    const config = {
      lug: { ...defaultJoint(), kind: "screw", parent: "stop", max: "360 deg" },
    };
    const check = {
      type: "check",
      version: 1,
      token: 1,
      coordinate: 0,
      id: "lug",
      pair: "stop",
      config,
      values: {},
      drivers: {},
      range: true,
      maxProbes: 5,
    };
    const r = await checkPair(parts, ["lug", "stop"], check);
    assert.equal(r.status, "interference");
    assert.equal(r.coordinate, 90);
    const displaced = {
      ...config,
      lug: { ...config.lug, origin: ["0", "0.1 mm", "0"] },
    };
    assert.equal(
      (await checkPair(parts, ["lug", "stop"], { ...check, config: displaced }))
        .status,
      "interference",
    );
    console.log(
      "Detected a quarter-turn collision on a modified threaded body, including a displaced screw axis.",
    );
  } finally {
    lug.delete();
    stop.delete();
  }
  if (process.argv.includes("--pen")) {
    const project = JSON.parse(
      await readFile(
        new URL("../examples/twist-pen.turnmill", import.meta.url),
        "utf8",
      ),
    );
    const { evaluateModel } = await server.ssrLoadModule("/src/buildModel.ts");
    const { buildBodies, releaseBodies } =
      await server.ssrLoadModule("/src/geometry.ts");
    const { bodyIds } = await server.ssrLoadModule("/src/kinematics.ts");
    const { features, values } = await evaluateModel(project);
    const ids = bodyIds(features),
      bodies = buildBodies(features);
    const { resolveThreadMates } = await server.ssrLoadModule(
      "/src/threadMates.ts",
    );
    const config = resolveThreadMates(
      project.workspaces.joints,
      bodies.flatMap((b) => b.threadFrames || []),
      values,
      ids,
    );
    try {
      const q = {
        type: "check",
        version: 1,
        token: 1,
        coordinate: 0,
        id: "pen-cap",
        pair: "barrel-revolve",
        config,
        values,
        drivers: {},
        range: true,
        maxProbes: 3,
        requiredGap: 0.02,
      };
      const t = Date.now(),
        r = await checkPair(bodies, ids, q, console.log);
      console.log(
        "Two-turn sample pen",
        r.message,
        Math.round((Date.now() - t) / 1000) + " s.",
      );
      assert.equal(r.status, "clear");
      assert.ok(r.lowerBound > 0.02 && r.lowerBound <= r.sampledGap);
      const high = await checkPair(bodies, ids, { ...q, requiredGap: 0.06 });
      assert.equal(high.status, "below-target");
      console.log(high.message);
    } finally {
      releaseBodies(bodies);
    }
  }
} finally {
  await server.close();
}
