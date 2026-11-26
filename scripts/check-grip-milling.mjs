import assert from "node:assert/strict";
import { makeBox, measureVolume } from "replicad";
import { geometry, near, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { buildBodies, releaseBodies, exportBodies } = await api.load("geometry");
  const { evaluateFinish } = await api.load("finishingTypes");
  const { importSolidFile } = await api.load("exchangeSolids");
  const tube = {
    id: "tube", name: "Tube", kind: "revolve", operation: "new", amount: 360,
    points: [[0, 3], [0, 6], [30, 6], [30, 3]],
  };
  const stockArea = Math.PI * (6 ** 2 - 3 ** 2);
  const stockVolume = stockArea * 30;
  const settings = {
    id: "grip", kind: "grip", name: "Grip", end: "start", offset: "4 mm",
    length: "span", width: "0.8 mm", depth: "1/100 in", count: "6",
  };
  function mill(style, edits = {}, feature = tube) {
    const finish = evaluateFinish({ ...settings, style, ...edits }, {span: 12});
    return buildBodies([{ ...feature, finishes: [finish] }]);
  }
  function measureBand(shape, fromX, toX) {
    const window = makeBox([fromX, -7, -7], [toX, 7, 7]);
    try {
      const section = shape.intersect(window);
      try { return measureVolume(section); } finally { section.delete(); }
    } finally { window.delete(); }
  }

  // A straight flute has one flat floor at its specified radial depth.
  function checkIndexedFloors(shape) {
    const faces = shape.faces;
    const angles = [];
    try {
      for (const face of faces) {
        if (face.geomType !== "PLANE") continue;
        const center = face.center;
        try {
          const [x, y, z] = center.toTuple();
          if (Math.abs(x - 10) < 1e-5 && Math.abs(Math.hypot(y, z) - (6 - 0.254)) < 1e-5)
            angles.push(Math.atan2(y,z));
        } finally { center.delete(); }
      }
    } finally { faces.forEach(f => f.delete()); }
    angles.sort((a,b) => a-b);
    assert.equal(angles.length, 6, "six flat-bottomed flutes around the circumference");
    for (let i = 1; i < angles.length; i++)
      near(angles[i] - angles[i-1], Math.PI / 3, 1e-5, "60-degree indexing");
  }

  const removed = {};
  for (const style of ["rings", "flutes", "crosscut"]) {
    const bodies = mill(style);
    try {
      const solid = bodies[0].shape;
      const data = geometry(solid);
      assert(data.valid && data.solids === 1, style + " makes one valid solid");
      removed[style] = stockVolume - data.volume;
      if (style === "flutes") checkIndexedFloors(solid);
      assert(removed[style] > 0.1, style + " removes measurable stock");
      near(measureBand(solid, 0, 4), stockArea * 4, 1e-4, style + " leaves the front outside the band intact");
      near(measureBand(solid, 16, 30), stockArea * 14, 1e-4, style + " leaves the back outside the band intact");
      const transferred = await importSolidFile("step", exportBodies(bodies, "step"), style);
      try {
        assert.equal(transferred.length, 1);
        const step = geometry(transferred[0].shape);
        assert(step.valid && step.solids === 1);
        near(step.volume, data.volume, 0.001, style + " STEP");
      } finally { releaseBodies(transferred); }
    } finally { releaseBodies(bodies); }
  }
  const ringArea = Math.PI * (6 ** 2 - (6 - 0.254) ** 2);
  near(removed.rings, ringArea * 6 * 0.8, 1e-4, "six complete rings at specified depth and width");
  assert(removed.crosscut > Math.max(removed.rings, removed.flutes), "cross-cut mills both directions");
  assert(removed.crosscut < removed.rings + removed.flutes, "overlapping cuts remove stock just once");

  const rear = mill("rings", { end: "end", count: "1" });
  try {
    near(measureBand(rear[0].shape, 0, 14), stockArea * 14, 1e-4, "rear band measured from its selected end");
    near(stockVolume - measureVolume(rear[0].shape), ringArea * 0.8, 1e-4, "one ring");
  } finally { releaseBodies(rear); }

  const suppressed = mill("flutes", {suppressed: true});
  try { near(measureVolume(suppressed[0].shape), stockVolume, 1e-5, "suppressed grip restores stock"); }
  finally { releaseBodies(suppressed); }
  for (const edits of [{depth: "3.1 mm"}, {offset: "28 mm"}, {width:"4 mm"}, {count:"2.5"}]) {
    assert.throws(() => { const bodies = mill("rings", edits); releaseBodies(bodies); },
      Error, "reject invalid grip setting " + JSON.stringify(edits));
  }
  console.log("PASS three milled grip patterns, analytic ring dimensions, indexed band extents, suppression, bad cuts and STEP reimport.");
} finally { await api.close(); }
