import assert from "node:assert/strict";
import { boxSketch, feature, geometry, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { slimBarrelFloor, narrowBarrel } = await api.load("slimBarrel");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { measureWritingBodyGeometry } = await api.load("writingFitGeometry");
  const { collectFitSurfaces } = await api.load("fitSurfaces");
  const { addRefillBacking } = await api.load("refillBacking");
  const { resolveParameters } = await api.load("expressions");
  const turn = feature("barrel", "meridian", 360, "revolve");
  const blank = project([boxSketch("meridian", 0, 5, 120, 10)], [turn], {
    parameters: [{ name: "slim_od", expression: "7.35 mm" }, { name: "slim_bore", expression: "6.55 mm" }],
  });
  const plan = {
    kind: "shoulder", openRear: true, barrelId: "barrel", axis: "X", centerline: [0, 0, 0], gap: .15,
    faceStation: 104.15, backStation: 106.15, boreDiameter: 10, ventDiameter: 3.175
  };
  const backed = addRefillBacking(blank, plan);
  const values = resolveParameters(blank.parameters);
  function resized(doc, od = "slim_od", bore = "slim_bore", wall = .35) {
    return narrowBarrel(doc, "barrel", od, bore, resolveParameters(doc.parameters), wall);
  }
  async function measured(doc) {
    const bodies = buildBodies((await evaluateModel(doc)).features);
    try {
      return {
        stock: geometry(bodies[0].shape), surfaces: collectFitSurfaces(bodies[0].shape, "barrel"),
        seats: measureWritingBodyGeometry(bodies[0].shape).seats
      };
    } finally { releaseBodies(bodies); }
  }
  near(slimBarrelFloor(backed, "barrel", 6.55, .35), 7.25, 1e-9, "plain barrel needs only its specified wall");
  const next = resized(backed);
  assert.deepEqual(next.features.map(f => f.id), backed.features.map(f => f.id));
  const stopFace = p => p.seats.find(s => Math.abs(s.center[0] - 104.15) < 1e-6 && s.direction === -1);
  const first = await measured(next);
  near(first.stock.bbox[1][1] - first.stock.bbox[0][1], 7.35, 1e-7, "requested OD achieved");
  near(stopFace(first).inner, 3.175, 1e-7, "existing through vent retained");
  near(stopFace(first).outer, 6.55, 1e-7, "stop still bears against the real bore");
  assert.equal(first.stock.solids, 1);
  const updated = await measured({ ...next, parameters: next.parameters.map(p => p.name === "slim_od" ? { ...p, expression: "7.5 mm" } : p) });
  near(updated.stock.bbox[1][1] - updated.stock.bbox[0][1], 7.5, 1e-7, "editable outside dimension");
  assert.equal(backed.sketches[0].points[1].y, "5");
  const named = structuredClone(backed);
  named.parameters.push({ name: "outer_diameter", expression: "2 cm" }, { name: "bore_diameter", expression: "10 mm" });
  const meridian = named.sketches.find(s => s.id === turn.sketchId);
  meridian.points[0].y = "bore_diameter / 2";
  meridian.constraints.push(
    { id: "inner-land", type: "horizontal", indices: [0] },
    { id: "outer-land", type: "horizontal", indices: [2] },
    { id: "outer-radius", type: "y", indices: [2], value: "outer_diameter / 2" },
  );
  const backing = named.sketches.find(s => s.id !== meridian.id);
  backing.points[1].y = backing.points[2].y = "bore_diameter / 2";
  const namedResult = resized(named);
  const dimensions = resolveParameters(namedResult.parameters);
  near(dimensions.outer_diameter, 7.35, 1e-12, "original OD parameter reports the finished size");
  near(dimensions.bore_diameter, 6.55, 1e-12, "original bore parameter reports the finished bore");
  const { selectionParameters } = await api.load("selectionParameters");
  const rows = selectionParameters(namedResult, { feature: namedResult.features[0] });
  assert(rows.some(p => p.name === "outer_diameter" && p.expression === "7.35 mm"));
  assert(rows.some(p => p.name === "bore_diameter" && p.expression === "6.55 mm"));
  const namedMeridian = namedResult.sketches.find(s => s.id === meridian.id);
  near(Number(namedMeridian.points[1].y), 6.55 / 2, 1e-12, "horizontal bore seed uses the new named diameter");
  near(Number(namedMeridian.points[3].y), 7.35 / 2, 1e-12, "horizontal outside seed uses the new named diameter");
  const namedShape = await measured(namedResult);
  near(namedShape.stock.volume, first.stock.volume, 1e-6, "named diameters generate the same sleeve and rear stop");
  near(stopFace(namedShape).outer, 6.55, 1e-7, "named stop driver follows the resized bore");
  const second = resized(namedResult, 8, 7);
  near(resolveParameters(second.parameters).outer_diameter, 8, 1e-12, "a second resize retains the OD driver");
  near(stopFace(await measured(second)).outer, 7, 1e-7, "a second resize retains the bore and stop drivers");

  const formula = structuredClone(named);
  formula.parameters.push({ name: "stock_size", expression: "21 mm" });
  formula.parameters.find(p => p.name === "outer_diameter").expression = "stock_size - 1 mm";
  const independent = resized(formula);
  assert.equal(independent.parameters.find(p => p.name === "outer_diameter").expression, "stock_size - 1 mm");
  near((await measured(independent)).stock.volume, first.stock.volume, 1e-6, "a derived stock dimension uses local sizing");
  const mirror = { ...blank, sketches: blank.sketches.map(s => ({ ...s, points: s.points.map(p => ({ ...p, y: "-(" + p.y + ")" })) })) };
  near((await measured(resized(mirror))).stock.volume, Math.PI * (7.35 ** 2 - 6.55 ** 2) * 120 / 4, 1e-6, "negative meridian");
  const grip = {
    id: "fluting", name: "Grip rings", kind: "grip", style: "rings", end: "start", offset: "12 mm", length: "8 mm",
    depth: ".25 mm", width: "1 mm", count: "2"
  };
  const gripped = { ...blank, features: [{ ...turn, finishes: [grip] }] };
  near(slimBarrelFloor(gripped, "barrel", 6.55, .35), 7.75, 1e-8, "minimum includes the actual retained grip depth");
  assert.throws(() => resized(gripped, 7.35), /thin|at least/);
  const overlapping = { ...blank, features: [{ ...turn, finishes: [grip, { ...grip, id: "second-grip" }] }] };
  near(slimBarrelFloor(overlapping, "barrel", 6.55, .35), 8.25, 1e-8, "overlapping finish bands reserve both cut depths");
  const fittedGrip = await measured(resized(gripped, 7.75));
  assert(fittedGrip.surfaces.some(s => s.side === "shaft" && Math.abs(s.diameter - 7.25) < 1e-6), "ring cut held 0.35 mm wall");
  const standardKnurl = {
    ...grip, id: "knurl", name: "Knurl", kind: "knurl", style: "straight", diameter: "20 mm",
    depth: ".08 mm", angle: "45 deg", count: "8"
  };
  const knurled = resized({ ...blank, features: [{ ...turn, finishes: [standardKnurl] }] }, 8.0);
  assert.equal((await measured(knurled)).stock.solids, 1);
  const thread = {
    id: "thread", name: "Cap socket", kind: "thread", side: "internal", preparation: "socket", end: "start",
    mode: "cosmetic", pitch: ".5 mm", diameter: "7.3 mm", length: "2 mm", preset: "Custom", hand: "right"
  };
  assert.throws(() => resized({ ...blank, features: [{ ...turn, finishes: [thread] }] }, 7.8), /wall below a barrel thread/);
  const profile = points => ({ ...blank.sketches[0], points: points.map(([x, y]) => ({ x: String(x), y: String(y) })) });
  const closed = { ...blank, sketches: [profile([[0, 5], [0, 10], [120, 10], [120, 0], [111, 0], [111, 5]])] };
  assert((await measured(resized(closed))).seats.some(s => s.inner === 0 && s.direction === -1 && Math.abs(s.center[0] - 111) < 1e-6));
  const vented = { ...blank, sketches: [profile([[0, 5], [0, 10], [120, 10], [120, 1.6], [111, 1.6], [111, 5]])] };
  assert((await measured(resized(vented))).seats.some(s => Math.abs(s.inner - 3.2) < 1e-6 && Math.abs(s.center[0] - 111) < 1e-6));
  const solid = {
    ...blank, sketches: [boxSketch("meridian", 0, 0, 120, 10)], features: [{
      ...turn, finishes: [{
        id: "bore",
        name: "Blind bore", kind: "hole", diameter: "10 mm", termination: "blind", end: "start", length: "111 mm"
      }]
    }]
  };
  const drilled = await measured(resized(solid));
  assert(drilled.seats.some(s => s.inner === 0 && s.direction === -1 && Math.abs(s.center[0] - 111) < 1e-6));
  const namedDrill = structuredClone(solid);
  namedDrill.parameters.push({ name: "drill_diameter", expression: "10 mm" });
  namedDrill.features[0].finishes[0].diameter = "drill_diameter";
  const slimDrill = resized(namedDrill);
  assert.equal(slimDrill.features[0].finishes[0].diameter, "drill_diameter");
  near(resolveParameters(slimDrill.parameters).drill_diameter, 6.55, 1e-8, "named drill resizes the actual hole");
  near((await measured(slimDrill)).stock.volume, drilled.stock.volume, 1e-6, "named and literal blind drills cut matching geometry");
  const raised = {
    ...turn, finishes: [{
      id: "boss", kind: "mark", name: "Brand", method: "emboss", end: "start",
      depth: ".25 mm", height: "1 mm", rotation: "0 deg", offset: "10 mm", content: "text", text: "A"
    }]
  };
  assert.throws(() => resized({ ...blank, features: [raised] }), /raised mark/);
  assert.throws(() => resized({ ...blank, features: [turn, { ...turn, id: "cut", operation: "cut", bodyId: "barrel" }] }), /individual wall/);
  assert.throws(() => narrowBarrel(blank, "barrel", 6, 7, values, .2), /larger than/);
  console.log("PASS slim barrel OD and wall, adaptive backing, original axial fit, parametric resize, blind and vented stock, local finishing limits.");
} finally { await api.close(); }
