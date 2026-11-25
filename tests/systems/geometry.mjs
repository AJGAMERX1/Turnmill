import assert from "node:assert/strict";
import {
  runtime,
  geometry,
  near,
  save,
  boxSketch,
  feature,
  project,
} from "./runtime.mjs";
const api = await runtime();
const { evaluateModel } = await api.load("buildModel"),
  { buildBodies, releaseBodies } = await api.load("geometry");
const sketches = [
  boxSketch("plate", 0, 0, 20, 12),
  boxSketch("tube", 0, 3, 12, 5),
  boxSketch("pocket", 3, 2, 7, 8),
  boxSketch("square", 6, 3, 8, 5),
  boxSketch("sec", -1, -1, 1, 1),
  boxSketch("path", 0, 6, 20, 9),
  boxSketch("low", 4, 4, 8, 8),
  boxSketch("high", 5, 5, 7, 7),
];
const plate = feature("Plate", "plate", 8),
  tube = feature("Tube", "tube", 360, "revolve"),
  coupon = feature("Coupon", "square", 4);
const finish = (f, v) => ({
  ...f,
  finishes: [{ ...v, id: "op", name: v.kind, end: v.end || "end" }],
});
const advanced = (f, v) => ({
  ...f,
  operations: [{ id: "op", name: v.kind, suppressed: false, operation: v }],
});
const cases = [];
const add = (label, features, volume, bounds, counts, notes) =>
  cases.push({ label, features, volume, bounds, counts, notes });
const pv = 1920,
  tv = 192 * Math.PI,
  pb = [
    [0, 0, 0],
    [20, 12, 8],
  ],
  tb = [
    [0, -5, -5],
    [12, 5, 5],
  ];
add("extrude", [plate], pv, pb, [1, 6, 12]);
add("revolve tube", [tube], tv, tb, [1, 4, 6]);
add(
  "blind rectangular cut",
  [
    plate,
    { ...feature("Cut", "pocket", 4), operation: "cut", bodyId: "Plate" },
  ],
  pv - 4 * 6 * 4,
  pb,
  [1, 11, 24],
);
add(
  "open shell",
  [advanced(plate, { kind: "shell", face: "zMax", thickness: "1" })],
  pv - 18 * 10 * 7,
  pb,
  [1, 11, 24],
);
add(
  "blind concentric bore",
  [finish(tube, { kind: "hole", diameter: "7", length: "4" })],
  tv - Math.PI * (3.5 ** 2 - 3 ** 2) * 4,
  tb,
);
const r = 0.35,
  R = 5;
add(
  "outer chamfer",
  [finish(tube, { kind: "chamfer", rims: "outer", size: String(r) })],
  tv - Math.PI * (R * r * r - r ** 3 / 3),
  tb,
);
const filletCut =
  2 * Math.PI * ((R - r) * r * r * (1 - Math.PI / 4) + r ** 3 / 6);
add(
  "outer fillet",
  [finish(tube, { kind: "fillet", rims: "outer", size: String(r) })],
  tv - filletCut,
  tb,
);
add(
  "linear pattern",
  [
    advanced(coupon, {
      kind: "linearPattern",
      axis: "X",
      count: "3",
      spacing: "8",
    }),
  ],
  48,
  [
    [6, 3, 0],
    [24, 5, 4],
  ],
  [3, 18, 36],
);
add(
  "circular pattern",
  [
    advanced(coupon, {
      kind: "circularPattern",
      axis: "Z",
      count: "4",
      stepAngle: "90 deg",
    }),
  ],
  64,
  [
    [-8, -8, 0],
    [8, 8, 4],
  ],
  [4, 24, 48],
);
add(
  "mirror",
  [
    advanced(coupon, {
      kind: "mirror",
      plane: "YZ",
      offset: "2",
      keepOriginal: false,
    }),
  ],
  16,
  [
    [-4, 3, 0],
    [-2, 5, 4],
  ],
  [1, 6, 12],
);
add(
  "straight sweep",
  [
    advanced(plate, {
      kind: "sweep",
      sectionId: "sec",
      pathId: "path",
      firstVertex: 0,
      lastVertex: 1,
      direction: "forward",
      anchorX: "0",
      anchorY: "0",
      z: "4",
      mode: "replace",
    }),
  ],
  80,
  [
    [0, 5, 3],
    [20, 7, 5],
  ],
  [1, 6, 12],
);
add(
  "square frustum loft",
  [
    advanced(plate, {
      kind: "loft",
      lowerId: "low",
      upperId: "high",
      z1: "0",
      z2: "8",
      mode: "replace",
    }),
  ],
  (8 * (16 + 8 + 4)) / 3,
  [
    [4, 4, 0],
    [8, 8, 8],
  ],
  [1, 6, 12],
);
const thread = {
  kind: "thread",
  diameter: "10",
  length: "3",
  pitch: "0.75",
  preset: "Custom",
  side: "external",
  hand: "right",
  mode: "modeled",
};
add(
  "cosmetic thread",
  [finish(tube, { ...thread, mode: "cosmetic" })],
  tv,
  tb,
  [1, 4, 6],
);
// An integer number of turns removes the same integrated sector on every axial ray.
// For radial height u above the external root, axial groove width is P/4 + 2u/√3.
const pitch = 0.75,
  engagement = 3,
  depth = (5 * Math.sqrt(3) * pitch) / 16,
  rootRadius = 5 - depth;
const removed =
  ((2 * Math.PI * engagement) / pitch) *
  ((pitch / 4) * (rootRadius * depth + depth ** 2 / 2) +
    (2 / Math.sqrt(3)) * ((rootRadius * depth ** 2) / 2 + depth ** 3 / 3));
add(
  "modeled thread",
  [finish(tube, thread)],
  tv - removed,
  tb,
  null,
  "analytic integration of the nominal CAD flank over four turns, not a tolerance-class test",
);
for (const style of ["straight", "diamond"])
  add(
    style + " knurl",
    [
      finish(tube, {
        kind: "knurl",
        style,
        diameter: "10",
        length: "3",
        depth: ".15",
        offset: "2",
        count: "6",
        angle: "30 deg",
      }),
    ],
    null,
    tb,
    null,
    "removed material; pending external reference",
  );
for (const [surface, f, bounds] of [
  ["flat", plate, pb],
  ["cylindrical", tube, tb],
]) {
  for (const method of ["engrave", "emboss"])
    add(
      surface + " " + method,
      [
        finish(f, {
          kind: "mark",
          content: "text",
          text: "A",
          method,
          height: "2",
          depth: ".2",
          offset: "3",
          rotation: "0 deg",
        }),
      ],
      null,
      method === "engrave" ? bounds : null,
      null,
      "nonzero " + method + "; pending external reference",
    );
}
const rows = [];
try {
  for (const c of cases) {
    const { features } = await evaluateModel(project(sketches, c.features));
    const bodies = buildBodies(features);
    try {
      assert.equal(bodies.length, 1);
      const m = geometry(bodies[0].shape);
      assert(
        m.valid &&
          m.volume > 0 &&
          m.area > 0 &&
          m.faces > 0 &&
          m.edges > 0 &&
          m.solids > 0,
      );
      if (c.volume !== null)
        near(
          m.volume,
          c.volume,
          Math.abs(c.volume) * 0.001,
          c.label + " volume",
        );
      else if (c.label.includes("emboss"))
        assert.ok(m.volume > (c.label.startsWith("flat") ? pv : tv));
      else assert.ok(m.volume < (c.label.startsWith("flat") ? pv : tv));
      if (c.bounds)
        c.bounds
          .flat()
          .forEach((v, i) =>
            near(m.bbox.flat()[i], v, 0.01, c.label + " bbox " + i),
          );
      if (c.counts)
        assert.deepEqual(
          [m.solids, m.faces, m.edges],
          c.counts,
          c.label + " topology",
        );
      rows.push({
        feature: c.label,
        expectedVolume: c.volume,
        expectedBounds: c.bounds,
        expectedTopology: c.counts,
        comparison: c.notes || "analytic",
        ...m,
      });
    } finally {
      releaseBodies(bodies);
    }
  }
  console.log(
    "PASS",
    rows.length,
    "feature invariants incl. exact analytic volume/bounds and topology where specified.",
  );
} finally {
  await save("geometry.json", rows);
  await api.close();
}
