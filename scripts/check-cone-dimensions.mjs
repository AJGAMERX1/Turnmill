import assert from "node:assert/strict";
import { runtime } from "../tests/systems/runtime.mjs";

const api = await runtime(false);
try {
  const { coneSegments, setConeDiameter } = await api.load("coneDimensions");
  const { changeProfileRange, profileRange } = await api.load("profileSizing");
  const { solveSketch } = await api.load("solveSketch");
  const sketch = (points, constraints = []) => ({
    id: "grip", name: "Grip cone", points: points.map(([x, y]) => ({ x: String(x), y: String(y) })), constraints,
  });
  const only = (s, values = {}) => {
    const items = coneSegments(s, values);
    assert.equal(items.length, 1);
    return items[0];
  };
  const diam = (s, end, expression, values = {}) => setConeDiameter(s, only(s, values), end, expression, values);
  const dims = (s, values = {}) => {
    const item = only(s, values);
    return [item.startDiameterMm, item.endDiameterMm, item.tipEnd];
  };

  // Every cyclic representation of the same triangular profile, on either side
  // of the axis. Opening the knife edge must keep its original bore vertex.
  for (const bore of [0, 3]) for (const sign of [-1, 1]) for (const orientation of [1, -1]) {
    const pts = [[0, bore * sign], [0, 6 * sign], [30, bore * sign]];
    if (orientation < 0) pts.reverse();
    for (let i = 0; i < pts.length; i++) {
      pts.push(pts.shift());
      const s = sketch(pts);
      const opened = diam(s, "end", "out_dia", { out_dia: 8 });
      assert.equal(opened.points.length, 4);
      assert.deepEqual(dims(opened, { out_dia: 10 }), [12, 10, "end"]);
      const result = await solveSketch(opened, { out_dia: 10 });
      const tip = result.vertices.filter(p => Math.abs(p.x - 30) < 1e-8);
      assert.deepEqual(tip.map(p => Math.abs(p.y)).sort((a, b) => a - b), [bore, 5]);
      assert.equal(s.points.length, 3);
    }
  }

  const sleeve = sketch([[0, 2], [0, 6], [30, 4], [30, 2]]);
  const cylinder = diam(sleeve, "end", "12 mm");
  assert.deepEqual(dims(JSON.parse(JSON.stringify(cylinder))), [12, 12, "end"]);
  const reversed = diam(cylinder, "end", "1/2 in");
  assert.deepEqual(dims(reversed), [12, 12.7, "end"]);
  assert.equal(only(reversed).endDiameter, "1/2 in");
  assert.throws(() => diam(sleeve, "end", "4 mm"), /above.*4 mm/);
  assert.throws(() => diam(sleeve, "end", "2 mm"), /above.*4 mm/);

  const named = sketch([[0, "bore/2"], [0, "base/2"], ["length", "tip/2"], ["length", "bore/2"]]);
  const values = { length: 55, base: 12, tip: 8, bore: 5, clearance: 0.5 };
  const driven = diam(named, "end", "bore + clearance", values);
  assert.deepEqual(driven.points.filter((_, i) => i !== 2), named.points.filter((_, i) => i !== 2));
  assert.equal(only(driven, values).endDiameter, "bore + clearance");
  assert.deepEqual(dims(driven, { ...values, bore: 6 }), [12, 6.5, "end"]);

  const stepped = sketch([[0, 2], [0, 6], [2, 6], [18, 4], [20, 4], [20, 2]], [
    { id: "land", type: "horizontal", indices: [3] }, { id: "radius", type: "y", indices: [4], value: "4" },
  ]);
  const land = diam(stepped, "end", "tip", values);
  assert.deepEqual((await solveSketch(land, { ...values, tip: 9 })).vertices.map(p => p.y), [2, 6, 6, 4.5, 4.5, 2]);
  const doubleTaper = sketch([[0, 2], [0, 6], [5, 4], [15, 5], [15, 2]]);
  assert.deepEqual(coneSegments(doubleTaper, {}).map(s => [s.startX, s.endX, s.tipEnd]), [[0, 5, "end"], [5, 15, "start"]]);
  const steppedBore = sketch([[0, 1], [0, 8], [20, 5], [20, 2], [12, 2], [12, 5.8], [8, 5.8], [8, 1]]);
  assert.throws(() => diam(steppedBore, "end", "7 mm"), /profile/);
  const constrained = { ...sleeve, constraints: [{ id: "intent", type: "angle", indices: [1], value: "9 deg" }] };
  assert.equal(coneSegments(constrained, {}).length, 0);

  const triangle = sketch([[0, 2], [0, 6], [30, 2]]);
  const sized = changeProfileRange(triangle, profileRange(triangle, "x", true, values), "size", "length", values);
  const opened = diam(sized, "end", "8 mm", values);
  assert.equal(profileRange(opened, "x", true, values).size, "length");
  assert.equal(only(opened, { ...values, length: 70 }).endX, 70);
  console.log("PASS cone ends, sharp tips, signed profiles, expressions, constraints, exterior lands, inverted tapers and wall protection");
} finally {
  await api.close();
}
