import assert from "node:assert/strict";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { createServer } from "vite";

const api = await createServer({
  configFile: false,
  server: { middlewareMode: true, ws: false, hmr: false },
  optimizeDeps: { noDiscovery: true },
  appType: "custom",
});
try {
  const { explodePen, penStudioIsoDirection } =
    await api.ssrLoadModule("/src/penExplode.ts");
  const box = (min, max) => new Box3(new Vector3(...min), new Vector3(...max));
  const matrix = (x, y, z) => new Matrix4().makeTranslation(x, y, z).toArray();
  const ids = ["cap", "clip", "body", "cone", "ink", "follower", "stud"];
  const project = {
    features: ids.map((id, i) => ({
      id,
      name: [
        "Screw-on cap",
        "Pocket clip",
        "Custom shell",
        "Writing cone",
        "Blue",
        "Refill carrier",
        "Thumb stud",
      ][i],
    })),
    workspaces: {
      refills: { ink: { bodyId: "ink" } },
      capMounts: { cap: { barrelId: "body" } },
      joints: {
        clip: { parent: "cap" },
        ink: { parent: "follower" },
        stud: { parent: "follower" },
      },
    },
  };
  const bounds = [
    box([0, -6, -6], [29, 6, 6]),
    box([0, 0, 0], [24, 2, 1.5]),
    box([0, -5, -5], [95, 5, 5]),
    box([0, -5, -5], [15, 5, 5]),
    box([0, -2.9, -2.9], [104, 2.9, 2.9]),
    box([0, -3.1, -3.1], [19, 3.1, 3.1]),
    box([-2, -2, -2], [2, 2, 2]),
  ];
  const original = [
    matrix(-14, 0, 0),
    matrix(-7, 5, 0),
    matrix(0, 0, 0),
    matrix(-11, 0, 0),
    matrix(-6, 0, 0),
    matrix(77, 0, 0),
    matrix(87, 0, 5),
  ];
  const initial = JSON.stringify([project, bounds, original]);

  function verify(input, gap, world, fixedCamera = false) {
    const view = new Vector3(...penStudioIsoDirection).normalize();
    if (fixedCamera) view.transformDirection(world.clone().invert());
    const camera = view.clone().transformDirection(world).toArray();
    const exploded = explodePen(project, ids, bounds, input, gap, camera);
    const inverse = world.clone().invert();
    const boxes = bounds.map((b, i) =>
      b
        .clone()
        .applyMatrix4(
          new Matrix4().fromArray(exploded[i]).premultiply(inverse),
        ),
    );
    const v = view
      .clone()
      .cross(new Vector3(1, 0, 0))
      .normalize();
    const u = v.clone().cross(view);
    const ranges = boxes.map((box) => {
      const corners = [];
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z])
            corners.push(new Vector3(x, y, z));
      return [u, v].map((axis) => {
        const values = corners.map((p) => p.dot(axis));
        return [Math.min(...values), Math.max(...values)];
      });
    });
    for (let i = 0; i < ids.length; i++) {
      assert.deepEqual(exploded[i].slice(0, 12), input[i].slice(0, 12));
      for (let j = i + 1; j < ids.length; j++) {
        if ([i, j].some((n) => [1, 4, 6].includes(n))) {
          const gap2d = Math.max(
            ...[0, 1].flatMap((k) => [
              ranges[i][k][0] - ranges[j][k][1],
              ranges[j][k][0] - ranges[i][k][1],
            ]),
          );
          assert(
            gap2d >= Math.min(gap * 0.35, 3) - 1e-6,
            "isometric silhouettes overlap: " + ids[i] + "/" + ids[j],
          );
        }
        const [a, b] = [boxes[i], boxes[j]];
        const largestGap = Math.max(
          ...["x", "y", "z"].flatMap((k) => [
            b.min[k] - a.max[k],
            a.min[k] - b.max[k],
          ]),
        );
        assert(
          largestGap >= gap - 1e-6,
          ids[i] + " and " + ids[j] + " clearance " + largestGap,
        );
      }
    }
    assert.deepEqual(exploded[2], input[2]);
    const [cap, clip, barrel, cone, refill, carrier, stud] = boxes;
    assert(cap.max.x + gap <= cone.min.x + 1e-7);
    assert(cone.max.x + gap <= barrel.min.x + 1e-7);
    assert(carrier.min.x >= barrel.max.x + gap - 1e-7);
    assert(refill.max.z <= barrel.min.z - gap + 1e-7);
    assert(Math.abs(refill.min.x + 6) < 1e-7);
    assert(clip.min.y >= cap.max.y + gap - 1e-7);
    assert(stud.min.z >= carrier.max.z + gap - 1e-7);
    return exploded;
  }

  const world = new Matrix4().compose(
    new Vector3(31, -53, 17),
    new Quaternion().setFromAxisAngle(
      new Vector3(0.31, -0.84, 0.46).normalize(),
      1.08,
    ),
    new Vector3(1, 1, 1),
  );
  const rotated = (array) =>
    new Matrix4().fromArray(array).premultiply(world).toArray();
  for (const gap of [1, 10, 40]) {
    const result = verify(original, gap, new Matrix4());
    const transformed = verify(original.map(rotated), gap, world);
    verify(original.map(rotated), gap, world, true);
    for (const [i, m] of result.entries())
      rotated(m).forEach((v, j) =>
        assert(Math.abs(v - transformed[i][j]) < 1e-7),
      );
  }
  assert.equal(explodePen(project, ids, [], original, 10), original);
  assert.equal(explodePen(project, ids, bounds, original, NaN), original);
  assert.equal(JSON.stringify([project, bounds, original]), initial);
  // Arbitrarily named, offset, native-Z-axis parts with a pre-rotated nose.
  const generic = {
    features: [
      { id: "a", name: "Part 1" },
      { id: "b", name: "Part 2" },
      { id: "c", name: "Part 3" },
    ],
  };
  const genericBounds = [
    box([11, 5, 23], [21, 15, 123]),
    box([14, 8, 18], [18, 12, 127]),
    box([0, -4, -4], [20, 4, 4]),
  ];
  const tipPose = new Matrix4()
    .makeRotationY(Math.PI / 2)
    .setPosition(16, 10, 25);
  const genericPose = [matrix(0, 0, 0), matrix(0, 0, 0), tipPose.toArray()];
  const genericResult = explodePen(
    generic,
    ["a", "b", "c"],
    genericBounds,
    genericPose,
    7,
  );
  assert.deepEqual(genericResult[0], genericPose[0]);
  assert.equal(genericResult[1][14], 0);
  assert(genericResult[1][13] < -10);
  assert(genericResult[2][14] < genericPose[2][14]);
  assert.deepEqual(genericResult[2].slice(0, 12), genericPose[2].slice(0, 12));
  console.log(
    "Passed anchored barrel, cap/cone order, parallel refill, clip/stud parent alignment, 1–40 mm gaps, posed and native Z-axis pens, and unchanged source poses.",
  );
} finally {
  await api.close();
}
