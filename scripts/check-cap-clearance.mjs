import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeCylinder, measureVolume } from "replicad";
import { geometry, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { createThreadedCap, compatiblePairSizes, legacyCapBarrelStock, legacyCapForBarrel, repairCapDiameter, shoulderOutside } = await api.load("threadedCone");
  const { defaultJoint, bodyIds } = await api.load("kinematics");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { verifyCapPosting } = await api.load("capClearanceGeometry");
  const parts = [["barrel", "Barrel", [[0,3.5],[0,5],[50,5],[50,3.5]]],
    ["refill", "Writing refill", [[0,0],[0,1],[15,1],[15,0]]]];
  const source = project(parts.map(([id, name, points]) => ({ id: id + "-s", name, constraints: [],
    points: points.map(([x,y]) => ({ x: String(x), y: String(y) })) })),
    parts.map(([id, name]) => ({ id, name, sketchId: id + "-s", operation: "new", kind: "revolve", amount: "360", suppressed: false })));
  const end = station => ({ axis: "X", centerline: [0,0,0], station, outside: 10, bore: 7 });
  const settings = { end: "end", size: "M8 × 0.75", length: "2.25 mm", allowance: "0.1 mm", mode: "cosmetic",
    capLength: "16 mm", capDiameter: "12 mm", crown: "flat", crownLength: "3 mm", wall: "1.5 mm" };
  for (const mode of ["cosmetic", "modeled"]) {
    const { project: pen, capId } = createThreadedCap(source, "barrel", end(50), { ...settings, mode }, end(0));
    const model = await evaluateModel(pen);
    const bodies = buildBodies(model.features);
    const ids = bodyIds(model.features);
    try {
      const verifyAt = position => {
        const placed = { ...pen, workspaces: { ...pen.workspaces, joints: { ...pen.workspaces.joints,
          barrel: { ...defaultJoint(), placement: { position: ["17","9","-2"], rotation: ["0","0","20"] } },
          refill: { ...defaultJoint(), parent: "barrel", offset: [String(position),"0","0"] } } } };
        verifyCapPosting(placed, capId, bodies, ids);
      };
      verifyAt(20); // Refill is entirely inside the through-bore.
      assert.throws(() => verifyAt(50), /front seat.*cap hits Writing refill/is);
      assert.throws(() => verifyAt(-17), /back seat.*cap hits Writing refill/is);
    } finally { releaseBodies(bodies); }
  }
  // Saved projects can still contain raised collars. A radial port that communicates
  // with a bore must stay open, even when the channel is eccentric and misses the axis.
  const { prepareThreadStock } = await api.load("threadPreparation");
  const { applyGripMilling } = await api.load("gripMilling");
  const frame = { axis: 0, center: [0, 0, 0], endCoord: 0, span: 32, radialBound: 8 };
  const collar = { preparation: "collar", end: "start", diameter: 17.9, pitch: 1.5, length: 5, collarStockDiameter: 15 };
  const owned = [];
  const own = shape => { owned.push(shape); return shape; };
  try {
    const blank = own(makeCylinder(7.5, 32, [0, 0, 0], [1, 0, 0]));
    const axial = (radius, y) => own(makeCylinder(radius, 32, [0, y, 0], [1, 0, 0]));
    const tube = own(blank.cut(axial(2.5, 0)));
    const fluted = own(applyGripMilling(tube, { style: "flutes", end: "start", count: 4, offset: 1,
      length: 10, width: 0.8, depth: 0.2 }));
    const fitted = own(prepareThreadStock(fluted, collar, frame));
    const measured = geometry(fitted);
    assert(measured.valid && measured.solids === 1, "collar forms one solid over shallow milled flutes");
    const outsideBand = own(makeCylinder(12, 20, [7, 0, 0], [1, 0, 0]));
    const originalGrip = own(fluted.intersect(outsideBand));
    assert(measureVolume(originalGrip) < Math.PI * (7.5 ** 2 - 2.5 ** 2) * 20 - 0.1, "the witness crosses unfilled flutes");
    near(measureVolume(own(fitted.intersect(outsideBand))), measureVolume(originalGrip), 1e-6, "exposed flutes retained");

    for (const channelY of [0, 4.6]) {
      const barrel = channelY === 0 ? tube : own(tube.cut(axial(0.7, channelY)));
      const port = own(makeCylinder(0.45, 12, [3, channelY, 0], [0, 0, 1]));
      const drilled = own(barrel.cut(port));
      const before = measureVolume(drilled);
      let prepared;
      try { prepared = own(prepareThreadStock(drilled, collar, frame)); }
      catch (error) { assert.match(error.message, /side opening|side port|opening into the barrel bore|cross.drill|vent/i); }
      if (prepared) near(measureVolume(own(prepared.intersect(port))), 0, 1e-6, "the radial port remains open through the collar");
      near(measureVolume(drilled), before, 1e-6, "the original ported barrel is untouched");
    }
  } finally { owned.reverse().forEach(shape => shape.delete()); }
  const { collectFitSurfaces } = await api.load("fitSurfaces");
  const { barrelEnd } = await api.load("threadedCone");
  const oldProject = JSON.parse(await readFile(new URL("../tests/projects/fixtures/raised-cap-mounts.turnmill", import.meta.url), "utf8"));
  const [capId] = Object.keys(oldProject.workspaces.capMounts);
  assert.equal(legacyCapForBarrel(oldProject, "barrel"), capId);
  const [barrel] = oldProject.features;
  const restoredStock = legacyCapBarrelStock(oldProject, capId);
  const machined = project([oldProject.sketches[0]], restoredStock.features);
  const socket = barrel.finishes.find(f => f.id === "nose-socket");
  const legacyBodies = buildBodies((await evaluateModel(oldProject)).features);
  try {
    const bounds = geometry(legacyBodies[0].shape).bbox;
    assert(bounds[1][1] - bounds[0][1] > 18, "the saved M18 mounting collars exceed the original 15 mm stock");
  } finally { releaseBodies(legacyBodies); }
  const stock = buildBodies((await evaluateModel(machined)).features);
  try {
    const surfaces = collectFitSurfaces(stock[0].shape, "barrel", true);
    const front = barrelEnd(surfaces, "X", "end"), back = barrelEnd(surfaces, "X", "start");
    assert.equal(front.outside, 15);
    assert.equal(back.outside, 15);
    near(shoulderOutside(front, 5), 13.8, 1e-6, "graduated front seat");
    near(shoulderOutside(back, 5), 13.2, 1e-6, "tapered back seat");
    const sizes = compatiblePairSizes(machined, "barrel", front, "cap", back, 0.1, 5);
    assert(sizes.includes("M12 × 1"));
    assert(!sizes.includes("M18 × 1.5"), "a new cap cannot enlarge the barrel");
    assert.throws(() => createThreadedCap(machined, "barrel", front, { ...settings, size: "M18 × 1.5" }, back));
    const fresh = createThreadedCap(machined, "barrel", front, { ...settings, size: sizes[0],
      length: "5 mm", matchBarrel: true }, back);
    assert.deepEqual(fresh.project.features[0].finishes.filter(f => f.side === "external").map(f => f.preparation), ["flush", "flush"]);
    const { project: pen, capId: repairedId } = repairCapDiameter(oldProject, capId, surfaces);
    const custom = repairCapDiameter(oldProject, capId, surfaces, undefined, false);
    assert.equal(custom.project.parameters.find(p => p.name === "cap_diameter").expression, "20 mm", "explicit custom cap diameter");
    assert.equal(repairedId, capId);
    assert.equal(pen.workspaces.capMounts[capId].active, "start", "repair preserves the active back mount");
    assert.equal(pen.workspaces.capMounts[capId].front, "end");
    assert.deepEqual(pen.features.map(f => f.id), oldProject.features.map(f => f.id));
    assert.deepEqual(pen.sketches.find(s => s.id === barrel.sketchId), oldProject.sketches[0]);
    assert.deepEqual(pen.features[0].finishes.find(f => f.id === "nose-socket"), socket);
    assert.equal(pen.parameters.find(p => p.name === "cap_length").expression, "40 mm");
    assert.equal(pen.parameters.find(p => p.name === "cap_wall").expression, "1.5 mm");
    assert.equal(oldProject.parameters.find(p => p.name === "cap_major").expression, "18 mm", "repair leaves the saved input intact");
    const model = await evaluateModel(pen);
    const built = buildBodies(model.features);
    try {
      const ids = bodyIds(model.features);
      assert.deepEqual(ids, ["barrel", capId]);
      const [barrelGeometry, capGeometry] = built.map(body => geometry(body.shape));
      assert(barrelGeometry.valid && barrelGeometry.solids === 1, "the repaired barrel must be one valid solid");
      assert(capGeometry.valid && capGeometry.solids === 1, "the repaired cap must be one valid solid");
      const capBounds = capGeometry.bbox;
      near(capBounds[1][1] - capBounds[0][1], 13.8, 1e-5, "the cap meets the original front shoulder");
      const mounts = built[0].threadFrames.filter(f => f.side === "external");
      assert.deepEqual(mounts.map(f => f.end).sort(), ["end", "start"]);
      for (const frame of mounts) {
        assert.equal(frame.mode, "modeled");
        near(frame.length, 5, 1e-7, "requested engaged length");
        near(frame.pitch, model.values.cap_pitch, 1e-7, "pitch matches the cap");
        near(frame.diameter, model.values.cap_major - model.values.cap_allowance, 1e-7, "external major with allowance");
        assert(frame.diameter < 15);
      }
      assert(built[0].threadFrames.some(f => f.finishId === "nose-socket"), "original nose socket still present");
      verifyCapPosting(pen, capId, built, ids);

      const bounds = barrelGeometry.bbox;
      for (const axis of [1, 2]) near(bounds[1][axis] - bounds[0][axis], 15, 1e-5, "original barrel diameter");
      near(bounds[0][0], 0, 1e-5, "original start");
      near(bounds[1][0], 125, 1e-5, "original end");
      const addedMaterial = built[0].shape.cut(stock[0].shape);
      try { near(Math.abs(measureVolume(addedMaterial)), 0, 1e-5, "neither flush mount adds material outside the original profile"); }
      finally { addedMaterial.delete(); }

      // Intersect exact cylinders with the resulting B-rep rather than trusting the feature parameters.
      const witnesses = [
        [0, 125, 3.5, 0, "through bore"],
        [122, 2, front.bore / 2, 0, "nose socket pilot"],
        [56.1, 1.8, 8, Math.PI * (6.4 ** 2 - 3.5 ** 2) * 1.8, "middle grip groove"],
      ];
      for (const [x, length, radius, expected, label] of witnesses) {
        const witness = makeCylinder(radius, length, [x, 0, 0], [1, 0, 0]);
        try {
          const common = built[0].shape.intersect(witness);
          try { near(measureVolume(common), expected, 1e-6, label); }
          finally { common.delete(); }
        } finally { witness.delete(); }
      }
    } finally { releaseBodies(built); }
  } finally { releaseBodies(stock); }
  console.log("PASS an existing raised M18 cap is refitted inside the original Ø15 stock at both ends. The taper, middle groove, socket and through bore survive.");
  console.log("PASS exact front and posted cap clearance against a protruding refill and both mated barrel ends, modeled and cosmetic");
} finally { await api.close(); }
