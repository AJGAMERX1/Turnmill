import assert from "node:assert/strict";
import { makeCylinder, measureVolume } from "replicad";
import { geometry, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { createThreadedCap } = await api.load("threadedCone");
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
  // Shallow exterior machining can sit beneath a collar. A radial port that communicates
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
  // The same 5 mm engagement must fit the cap over a tapered rear and a grooved front,
  // while the original internal socket and the grip groove outside both collars stay usable.
  const { collectFitSurfaces } = await api.load("fitSurfaces");
  const { barrelEnd } = await api.load("threadedCone");
  const landProfile = [[0, 3.5], [0, 7.5], [5, 6.6], [10, 7.5], [56, 7.5], [56, 6.4],
    [58, 6.4], [58, 7.5], [119, 7.5], [119, 6.9], [121, 6.9], [121, 7.5], [125, 7.5], [125, 3.5]];
  const machined = project([{ id: "profile", name: "Grip and taper", constraints: [],
    points: landProfile.map(([x, y]) => ({ x: String(x), y: String(y) })) }], [
    { id: "barrel", name: "Machined barrel", sketchId: "profile", kind: "revolve", operation: "new", amount: "360 deg",
      suppressed: false, finishes: [{ id: "nose-socket", name: "Existing nose socket", kind: "thread", preset: "M8 × 0.75",
        diameter: "8 mm", pitch: "0.75 mm", length: "4 mm", end: "end", side: "internal", hand: "right",
        preparation: "socket", preparationAxis: "X", mode: "cosmetic" }] }
  ]);
  const stock = buildBodies((await evaluateModel(machined)).features);
  try {
    const surfaces = collectFitSurfaces(stock[0].shape, "barrel", true);
    const front = barrelEnd(surfaces, "X", "end"), back = barrelEnd(surfaces, "X", "start");
    assert.equal(front.outside, 15);
    assert.equal(back.outside, 15);
    const { project: pen, capId } = createThreadedCap(machined, "barrel", front, {
      ...settings, size: "M18 × 1.5", length: "5 mm", capLength: "40 mm", capDiameter: "20 mm", mode: "modeled",
    }, back);
    const model = await evaluateModel(pen);
    const built = buildBodies(model.features);
    try {
      const ids = bodyIds(model.features);
      assert.deepEqual(ids, ["barrel", capId]);
      for (const body of built) {
        const measured = geometry(body.shape);
        assert(measured.valid && measured.solids === 1, body.name + " must be one valid solid");
      }
      const collars = built[0].threadFrames.filter(f => f.side === "external");
      assert.deepEqual(collars.map(f => f.end).sort(), ["end", "start"]);
      for (const frame of collars) {
        assert.equal(frame.mode, "modeled");
        near(frame.length, 5, 1e-7, "requested engaged length");
        near(frame.pitch, 1.5, 1e-7, "M18 pitch");
        near(frame.diameter, 17.9, 1e-7, "M18 external major with diametral allowance");
      }
      assert(built[0].threadFrames.some(f => f.finishId === "nose-socket"), "original nose socket still present");
      verifyCapPosting(pen, capId, built, ids);

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
  console.log("PASS one modeled M18 cap seats on a grooved and tapered barrel with both 5 mm engagements and the original socket and through bore.");
  console.log("PASS exact front and posted cap clearance against a protruding refill and both mated barrel ends, modeled and cosmetic");
} finally { await api.close(); }
