import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import initOC from "replicad-opencascadejs";
import { setOC } from "replicad";
import { Matrix4, Vector3 } from "three";

const solverModule = "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  plugins: [
    {
      name: "node-solver-wasm",
      enforce: "pre",
      resolveId(id) {
        if (id === solverModule + "?url") return "virtual:node-solver-wasm";
      },
      load(id) {
        if (id === "virtual:node-solver-wasm")
          return (
            "export default " +
            JSON.stringify(fileURLToPath(import.meta.resolve(solverModule)))
          );
      },
    },
  ],
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
  const { resolveThreadMates } = await server.ssrLoadModule(
    "/src/threadMates.ts",
  );
  const { buildPoses, bodyIds } =
    await server.ssrLoadModule("/src/kinematics.ts");
  const { twistPenProject } = await server.ssrLoadModule("/src/projects.ts");
  const portable = JSON.parse(
    await readFile(
      new URL("../examples/twist-pen.turnmill", import.meta.url),
      "utf8",
    ),
  );
  for (const project of [portable, twistPenProject()]) {
    // Cosmetic and modeled finishes expose the same axis and entrance. Use
    // cosmetic threads here so unrelated solid-cutting tests stay independent.
    for (const feature of project.features)
      for (const f of feature.finishes || [])
        if (f.kind === "thread") f.mode = "cosmetic";
    const { features, values } = await evaluateModel(project);
    const bodies = buildBodies(features);
    try {
      const frames = bodies.flatMap((b) => b.threadFrames || []),
        ids = bodyIds(features),
        config = project.workspaces.joints;
      assert.equal(frames.length, 2);
      const cap = config["pen-cap"],
        ref = cap.threadMate,
        a = frames.find((f) => f.bodyId === "pen-cap"),
        b = frames.find((f) => f.bodyId === "barrel-revolve");
      assert.equal(a.finishId, ref.moving.finishId);
      assert.equal(b.finishId, ref.mating.finishId);
      const resolve = (entries = frames, settings = config, active = ids) =>
        resolveThreadMates(settings, entries, values, active);
      const solved = resolve(),
        capIndex = ids.indexOf("pen-cap");
      const pose = (config, angle) =>
        new Matrix4().fromArray(
          buildPoses(ids, config, { "pen-cap": [angle] }, values)[capIndex],
        );
      const identity = new Matrix4();
      assert.deepEqual(pose(solved, 0).elements, identity.elements);
      const moved = pose(solved, 720);
      assert(Math.abs(moved.elements[12] - 1.5) < 1e-9);
      assert(
        Math.abs(
          pose(resolve(frames.map((f) => ({ ...f, pitch: 0.6 }))), 360)
            .elements[12] - 0.6,
        ) < 1e-9,
      );
      assert.throws(() => resolve([a, { ...b, pitch: 1 }]), /same pitch/);
      assert.throws(
        () => resolve([a, { ...b, hand: "left" }]),
        /same pitch and hand/,
      );
      assert.throws(
        () => resolve([a, { ...b, side: a.side }]),
        /internal and an external/,
      );
      assert.throws(() => resolve([a, { ...b, diameter: 1 }]), /flanks apart/);
      assert.throws(() => resolve([a]), /thread is missing/);
      assert.doesNotThrow(() => resolve([b], config, ["barrel-revolve"]));
      const rotated = { ...b, axis: "Z", entrance: [4, -2, 20], end: a.end };
      const link = {
        ...ref,
        placement: "entrances",
        engagement: "2 mm",
        phase: "30 deg",
      };
      const mounted = resolve([a, rotated], {
        ...config,
        "pen-cap": { ...cap, threadMate: link },
      });
      assert.throws(() => pose(mounted, 0), /same joint axis and parent/,
        "A cap remounted across axes cannot drive the original coaxial refill");
      // Study the remounted screw with its original follower uncoupled.
      mounted["pen-refill"] = { ...mounted["pen-refill"], cam: undefined };
      const point = (v) =>
        new Vector3(...a.entrance).applyMatrix4(pose(mounted, v));
      assert(point(0).distanceTo(new Vector3(4, -2, 22)) < 1e-8);
      assert(point(360).distanceTo(new Vector3(4, -2, 21.25)) < 1e-8);
      assert.throws(() => resolve([a, rotated]), /Align entrances/);
      assert.equal(
        config["pen-cap"].mount,
        undefined,
        "Computed registration stays out of the project file",
      );
    } finally {
      releaseBodies(bodies);
    }
  }
  console.log(
    "Passed live thread references in both pen templates, pitch and hand validation, repair after suppression, cross-axis seating, phase and screw travel.",
  );
} finally {
  await server.close();
}
