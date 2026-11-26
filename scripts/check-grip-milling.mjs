import assert from "node:assert/strict";
import { makeBox, makeCylinder, measureVolume } from "replicad";
import { geometry, near, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { buildBodies, releaseBodies, exportBodies } = await api.load("geometry");
  const { evaluateFinish } = await api.load("finishingTypes");
  const { applyGripMilling } = await api.load("gripMilling");
  const { measureGripStock } = await api.load("gripBands");
  const { collectFitSurfaces, collectTurnedCapSurfaces } = await api.load("fitSurfaces");
  const { barrelEnd, shoulderOutside } = await api.load("threadedCone");
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
  function checkIndexedFloors(shape, bandCenter = 10, radius = 6, depth = 0.254, slope = 0) {
    const faces = shape.faces;
    const angles = [];
    try {
      for (const face of faces) {
        if (face.geomType !== "PLANE") continue;
        const center = face.center;
        try {
          const [x, y, z] = center.toTuple();
          if (Math.abs(x - bandCenter) > 1e-5 || Math.abs(Math.hypot(y, z) - (radius - depth)) > 1e-5)
            continue;
          const normal = face.normalAt();
          try {
            const [nx, ny, nz] = normal.toTuple();
            const radial = Math.hypot(y, z);
            near(nx + slope * (ny * y + nz * z) / radial, 0, 1e-5, "flute floor follows stock slope");
          } finally { normal.delete(); }
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
      if (style === "flutes") {
        checkIndexedFloors(solid);
        const smoothFits = collectFitSurfaces(solid, "tube", true);
        assert(!smoothFits.some(s => s.side === "shaft" && Math.abs(s.diameter - 12) < 1e-6),
          "flutes interrupt the original OD face for smooth fit references");
        const seats = collectTurnedCapSurfaces(solid, "tube", smoothFits);
        const front = barrelEnd(seats, "X", "start"), back = barrelEnd(seats, "X", "end");
        near(front.station, 0, 1e-5, "thread datum at the original front face");
        near(back.station, 30, 1e-5, "thread datum at the original rear face");
        near(shoulderOutside(front, 3), 12, 1e-5, "intact round shoulder before flutes");
        near(shoulderOutside(back, 3), 12, 1e-5, "intact round shoulder behind flutes");
        assert(Number.isNaN(shoulderOutside(front, 4.5)), "the fluted seating station is interrupted");
        const interruptedToEnd = seats.filter(s => s.side !== "shaft" || s.start > 1e-5);
        assert.equal(barrelEnd(interruptedToEnd, "X", "start"), undefined,
          "interior land cannot supply a missing end datum");
      }
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

  // The reported settings span X=2..12 on a custom tapered revolve with a 6 mm bore.
  const taper = { ...tube, name: "Revolve 1", points: [[0,3], [0,6.6], [30,5.4], [30,3]] };
  const taperSettings = { offset:"2 mm", length:"10 mm", width:"0.6 mm", depth:"0.18 mm" };
  const slope = (5.4 - 6.6) / 30;
  const radius = x => 6.6 + slope * x;
  function taperVolume(a, b) {
    const ra = radius(a), rb = radius(b);
    return Math.PI * (b - a) * ((ra ** 2 + ra * rb + rb ** 2) / 3 - 3 ** 2);
  }
  const taperRemoval = {};
  for (const style of ["rings", "flutes", "crosscut"]) {
    const bodies = mill(style, taperSettings, taper);
    try {
      const solid = bodies[0].shape, data = geometry(solid);
      assert(data.valid && data.solids === 1, style + " makes a sound tapered barrel");
      taperRemoval[style] = taperVolume(0, 30) - data.volume;
      near(measureBand(solid, 0, 2), taperVolume(0, 2), 1e-4, style + " preserves nose outside band");
      near(measureBand(solid, 12, 30), taperVolume(12, 30), 1e-4, style + " preserves tail outside band");
      const core = makeCylinder(5, 30, [0,0,0], [1,0,0]);
      try {
        const wall = solid.intersect(core);
        try { near(measureVolume(wall), Math.PI * (5 ** 2 - 3 ** 2) * 30, 1e-4, style + " preserves bore and inner wall"); }
        finally { wall.delete(); }
      } finally { core.delete(); }
      if (style === "flutes") checkIndexedFloors(solid, 7, radius(7), .18, slope);
      if (style === "crosscut") {
        const roundtrip = await importSolidFile("step", exportBodies(bodies, "step"), "Tapered grip");
        try {
          assert.equal(roundtrip.length, 1);
          const step = geometry(roundtrip[0].shape);
          assert(step.valid && step.solids === 1);
          near(step.volume, data.volume, .001, "machined taper STEP volume");
        } finally { releaseBodies(roundtrip); }
      }
    } finally { releaseBodies(bodies); }
  }
  // The mean radius of these six equally spaced ring centers is the midpoint radius.
  near(taperRemoval.rings, 6 * .6 * Math.PI * (2 * .18 * radius(7) - .18 ** 2), 1e-4,
    "six taper-following rings at specified radial depth and axial width");
  assert(taperRemoval.crosscut > Math.max(taperRemoval.rings, taperRemoval.flutes));
  assert(taperRemoval.crosscut < taperRemoval.rings + taperRemoval.flutes);
  const reversed = { ...taper, points:taper.points.map(([x,y]) => [30-x, y]) };
  const rearTaper = mill("rings", { ...taperSettings, end:"end" }, reversed);
  try { near(taperVolume(0, 30) - measureVolume(rearTaper[0].shape), taperRemoval.rings, 1e-4,
    "reversing the taper and measurement end yields the same ring cuts"); }
  finally { releaseBodies(rearTaper); }
  const halfTurn = buildBodies([{ ...taper, amount:180 }]);
  try {
    const half = halfTurn[0].shape;
    assert.equal(measureGripStock(half).bands.length, 0, "a partial revolve has no complete grip surface");
    const otherHalf = half.clone().rotate(180, [0,0,0], [1,0,0]);
    try {
      const whole = half.fuse(otherHalf, {simplify:false});
      try {
        const { bands } = measureGripStock(whole);
        assert.equal(bands.length, 1, "halves of one turned outside surface form a complete grip surface");
        near(bands[0].start, 0, 1e-5, "angularly split face start");
        near(bands[0].end, 30, 1e-5, "angularly split face end");
        near(bands[0].endRadius, radius(30), 1e-5, "detect outside taper, excluding cylindrical bore");
      } finally { whole.delete(); }
    } finally { otherHalf.delete(); }
  } finally { releaseBodies(halfTurn); }
  const interrupted = { ...taper, points:[...taper.points, [10.5,3], [10.5,6.05], [10,6.05], [10,3]] };
  assert.throws(() => mill("rings", taperSettings, interrupted), /bore|wall|interrupted|depth/i,
    "reject a recessed bore that leaves too little wall inside the band");

  const turned = buildBodies([taper]);
  const crossDrill = makeCylinder(.75, 10, [7,0,0], [0,0,1]);
  try {
    const drilled = turned[0].shape.cut(crossDrill);
    try {
      const { bands } = measureGripStock(drilled);
      assert.equal(bands.length, 2, "radial hole splits stock into two usable bands");
      near(bands[0].end, 7 - .75, 1e-5, "first band stops at hole");
      near(bands[1].start, 7 + .75, 1e-5, "second band starts after hole");
      function gripAt(offset) {
        return evaluateFinish({...settings, ...taperSettings, style:"flutes", offset}, {});
      }
      assert.throws(() => applyGripMilling(drilled, gripAt("2 mm")).delete(),
        /bore|wall|interrupted|surface|gap/i, "avoid radial holes within a band");
      const clear = applyGripMilling(drilled, gripAt("15 mm"));
      try { assert(geometry(clear).valid, "a radial hole outside the band allows the grip"); }
      finally { clear.delete(); }
    } finally { drilled.delete(); }
  } finally { crossDrill.delete(); releaseBodies(turned); }

  console.log("PASS cylindrical and tapered grip B-reps, dimensions, indexed flute floors, protected wall, rejected cuts and STEP reimport.");
} finally { await api.close(); }
