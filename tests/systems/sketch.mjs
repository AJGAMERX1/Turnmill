import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runtime, near, save } from "./runtime.mjs";
const here = fileURLToPath(import.meta.url);
if (!process.env.TURNMILL_SOLVER_CHILD) {
  const child = fork(here, [], {
    env: { ...process.env, TURNMILL_SOLVER_CHILD: "1" },
  });
  let timer,
    active = "initialization";
  const watchdog = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.error("Timed out:", active);
      child.kill("SIGKILL");
    }, ms);
  };
  watchdog(15000);
  child.on("message", (m) => {
    active = m.case;
    watchdog(5000);
  });
  const status = await new Promise((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  clearTimeout(timer);
  if (status !== 0) process.exitCode = 1;
} else {
  const api = await runtime(false);
  const { solveSketch } = await api.load("solveSketch");
  const base = [
    [0, 0],
    [12, 0],
    [12, 7],
    [0, 7],
  ];
  const rule = (type, indices, value) => ({ type, indices, value });
  const norm = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pt = (p, i) => p[(i + 1) % p.length];
  const vec = (a, b) => [b.x - a.x, b.y - a.y];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const eps = (a, b) => near(a, b, 0.001, "constraint residual");
  const rows = [];
  async function run(name, points, constraints, check, invalid) {
    process.send({ case: name });
    const start = performance.now();
    const source = {
      id: "profile",
      name: "profile",
      points: points.map(([x, y]) => ({ x: String(x), y: String(y) })),
      constraints: constraints.map((c, i) => ({ ...c, id: "rule" + i })),
    };
    if (invalid) {
      let error;
      try {
        await solveSketch(source, {});
      } catch (e) {
        error = e;
      }
      assert.match(error?.message || "", invalid);
      rows.push({
        name,
        result: "rejected",
        message: error.message,
        ms: performance.now() - start,
      });
      return;
    }
    const s = await solveSketch(source, {});
    check(s, s.vertices);
    rows.push({
      name,
      result: "solved",
      dof: s.dof,
      redundant: s.redundant,
      ms: performance.now() - start,
    });
  }
  try {
    await run("underconstrained", base, [], (s) => assert.equal(s.dof, 8));
    const locked = base.map((p) => p.map((n) => n + " mm"));
    await run("fully constrained expressions", locked, [], (s) =>
      assert.equal(s.dof, 0),
    );
    await run(
      "redundant horizontal on locked endpoints",
      locked,
      [rule("horizontal", [0])],
      (s) => assert(s.redundant.length > 0),
    );
    await run(
      "contradictory X dims",
      base,
      [rule("x", [0], "0"), rule("x", [0], "5")],
      null,
      /conflict|cannot satisfy/i,
    );
    await run(
      "horizontal + vertical",
      [
        [0, 0],
        [12, 1],
        [11, 7],
        [0, 7],
      ],
      [rule("horizontal", [0]), rule("vertical", [1])],
      (_, p) => {
        eps(p[0].y, p[1].y);
        eps(p[1].x, p[2].x);
      },
    );
    await run(
      "parallel",
      [
        [0, 0],
        [12, 0],
        [12, 7],
        [0, 8],
      ],
      [rule("parallel", [0, 2])],
      (_, p) => {
        const a = vec(p[0], p[1]),
          b = vec(p[2], p[3]);
        eps(a[0] * b[1] - a[1] * b[0], 0);
      },
    );
    await run("equal", base, [rule("equal", [0, 1])], (_, p) =>
      eps(norm(p[0], p[1]), norm(p[1], p[2])),
    );
    await run("coincident", base, [rule("coincident", [0, 1])], (_, p) =>
      eps(norm(p[0], p[1]), 0),
    );
    for (const axis of ["X", "Y"])
      await run(
        "symmetric about " + axis,
        base,
        [rule("symmetric" + axis, [0, 2])],
        (_, p) => {
          eps(p[0].x, axis === "Y" ? -p[2].x : p[2].x);
          eps(p[0].y, axis === "X" ? -p[2].y : p[2].y);
        },
      );
    await run(
      "symmetric about edge",
      [
        [-5, 1],
        [5, 2],
        [0, 9],
        [0, 4],
      ],
      [rule("symmetric", [0, 1, 2])],
      (_, p) => {
        const axis = vec(p[2], p[3]),
          mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 },
          d = vec(p[2], mid);
        eps(dot(axis, vec(p[0], p[1])), 0);
        eps(axis[0] * d[1] - axis[1] * d[0], 0);
      },
    );
    await run(
      "point distance",
      base,
      [rule("distance", [0, 2], "26")],
      (_, p) => eps(norm(p[0], p[2]), 26),
    );
    await run("edge length", base, [rule("length", [0], "20")], (_, p) =>
      eps(norm(p[0], p[1]), 20),
    );
    await run(
      "X and Y dimensions",
      base,
      [rule("x", [1], "10"), rule("y", [1], "4")],
      (_, p) => {
        eps(p[1].x, 10);
        eps(p[1].y, 4);
      },
    );
    await run(
      "arc radius and tangent",
      base,
      [rule("arc", [1], "5"), rule("tangent", [0, 1])],
      (s, p) => {
        const a = p[1],
          b = s.edges[1].through,
          c = pt(p, 1);
        assert(b);
        const ab = norm(a, b),
          bc = norm(b, c),
          ca = norm(a, c);
        const twiceArea = Math.abs(
          (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
        );
        eps((ab * bc * ca) / (2 * twiceArea), 5);
        // Recover the circle center from perpendicular bisectors, then check tangency.
        const det =
          2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        const [aa, bb, cc] = [a, b, c].map((q) => q.x * q.x + q.y * q.y);
        const center = {
          x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / det,
          y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / det,
        };
        eps(dot(vec(p[0], a), vec(center, a)), 0);
      },
    );
    await run(
      "invalid arc radius",
      base,
      [rule("arc", [1], "2")],
      null,
      /radius must be at least/i,
    );
    await run(
      "removed constraint reference",
      base,
      [rule("length", [10], "5")],
      null,
      /missing vertex or edge/,
    );
    console.log(
      "PASS",
      rows.length,
      "solver cases, 5 s per solve OS watchdog.",
    );
  } finally {
    await save("sketch.json", rows);
    await api.close();
  }
}
