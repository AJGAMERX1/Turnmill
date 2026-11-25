import assert from "node:assert/strict";
import { makeSphere } from "replicad";
import { runtime, near, save } from "./runtime.mjs";
const api = await runtime();
const { defaultJoint, specs, jointKinds, buildPoses } =
  await api.load("kinematics");
const { checkPair } = await api.load("clearance"),
  { releaseBodies } = await api.load("geometry");
const ids = ["ground", "carrier"],
  bodies = ids.map((name) => ({ name, shape: makeSphere(1) })),
  rows = [];
try {
  for (const kind of jointKinds) {
    const freedoms = specs(kind),
      isAngle = freedoms[0]?.unit === "angle";
    const bounds = Object.fromEntries(
      freedoms.map((s, i) => [
        i,
        s.unit === "angle" ? ["0 deg", "180 deg"] : ["0 mm", "4 mm"],
      ]),
    );
    const cfg = {
      carrier: {
        ...defaultJoint(),
        kind,
        parent: "ground",
        axis: "X",
        offset: ["10 mm", "0", "0"],
        min: "0",
        max: isAngle ? "180 deg" : "4 mm",
        bounds,
        pitch: "0.8 mm",
      },
    };
    for (let k = 0; k < Math.max(freedoms.length, 1); k++) {
      const angle = freedoms[k]?.unit === "angle",
        end = angle ? 180 : freedoms.length ? 4 : 0;
      const step = angle ? 5 : 0.25;
      const poses = [];
      for (let v = 0; v <= end; v += step) {
        const coords = Array.from({ length: freedoms.length }, (_, j) =>
            j === k ? v : 0,
          ),
          drivers = { carrier: coords };
        const expected = [10, 0, 0];
        if (kind === "screw") expected[0] += (v * 0.8) / 360;
        if (freedoms[k]?.unit === "length") expected[freedoms[k].axis] += v;
        const matrix = buildPoses(ids, cfg, drivers, {})[1];
        expected.forEach((n, i) =>
          near(matrix[i + 12], n, 0.01, "pose " + kind),
        );
        const req = {
          id: "carrier",
          pair: "ground",
          coordinate: k,
          requiredGap: 0.1,
          maxProbes: 256,
          config: cfg,
          drivers,
          values: {},
          range: false,
        };
        const r = await checkPair(bodies, ids, req);
        assert.equal(r.status, "clear", r.message);
        const expectedGap = Math.hypot(...expected) - 2;
        near(r.sampledGap, expectedGap, 0.01, kind + " gap at " + v);
        poses.push({ at: v, expectedGap, measuredGap: r.sampledGap });
      }
      const bounded = buildPoses(
        ids,
        cfg,
        { carrier: freedoms.map((_, i) => (i === k ? end : 0)) },
        {},
      )[1];
      const overshoot = buildPoses(
        ids,
        cfg,
        { carrier: freedoms.map((_, i) => (i === k ? end + 10 : 0)) },
        {},
      )[1];
      overshoot.forEach((n, i) => near(n, bounded[i], 1e-10, "upper clamp"));
      const sweep = await checkPair(bodies, ids, {
        id: "carrier",
        pair: "ground",
        coordinate: k,
        requiredGap: 0.1,
        maxProbes: 256,
        config: cfg,
        drivers: {},
        values: {},
        range: true,
      });
      assert.equal(sweep.status, "clear", sweep.message);
      rows.push({ joint: kind, coordinate: k, step, poses, continuous: sweep });
    }
  }
  console.log(
    "PASS",
    rows.reduce((n, v) => n + v.poses.length, 0),
    "exact B-rep gap measurements and",
    rows.length,
    "coverage certificates for seven joints.",
  );
} finally {
  releaseBodies(bodies);
  await save("motion.json", rows);
  await api.close();
}
