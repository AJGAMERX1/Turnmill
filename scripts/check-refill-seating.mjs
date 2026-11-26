import assert from "node:assert/strict";
import { Matrix4, Vector3 } from "three";
import { near, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { evaluateModel } = await api.load("buildModel");
  const { blankProject } = await api.load("projects");
  const { insertRefill, reverseRefill } = await api.load("refills");
  const { solidBounds } = await api.load("secondaryProjection");
  const { positioned } = await api.load("motionGeometry");
  const { refillOpenings, seatRefill, refillSnapClearance } = await api.load("refillSeating");
  const { measureRefillSurfaces, verifyRefillSeat } = await api.load("refillSeatingGeometry");
  const donor = insertRefill(blankProject(), "bic-round-stic", {}, { bodyId: "donor" }).project;
  const project = reverseRefill(donor, "donor");
  const { features } = await evaluateModel(project);
  const sleeve = (id, points) => ({ id, kind: "revolve", operation: "new", amount: 360, points });
  const solids = buildBodies([...features,
    sleeve("sleeve", [[20,2.05],[20,5],[155,5],[155,2.05]]),
    sleeve("short", [[20,2.05],[20,5],[155,5],[155,0],[100,0],[100,2.05]]),
    sleeve("tight", [[20,1.95],[20,5],[155,5],[155,1.95]]),
  ]);
  try {
    const [cartridge, barrel, blind, narrow] = solids.map(b => b.shape);
    const shafts = measureRefillSurfaces(cartridge, "donor");
    const lands = measureRefillSurfaces(barrel, "sleeve");
    const openings = refillOpenings(lands, solidBounds(barrel));
    assert.deepEqual(openings.map(o => o.station), [20,155]);
    for (const o of openings) {
      const m = seatRefill(project, "donor", o);
      const x = local => new Vector3(local,0,0).applyMatrix4(m).x;
      near(x(122), o.station, 1e-7, "collar plane");
      near(x(132), o.end === "start" ? 10 : 165, 1e-7, "reversed writing tip");
      near(refillSnapClearance(shafts, lands, m).clearance, .1, 1e-7, "donor shank clearance");
      verifyRefillSeat(cartridge, barrel, m.toArray());
    }
    const blindLands = measureRefillSurfaces(blind, "blind");
    const blindOpenings = refillOpenings(blindLands, solidBounds(blind));
    assert.deepEqual(blindOpenings.map(o => o.station), [20], "blind bottom excluded");
    const blindPose = seatRefill(project, "donor", blindOpenings[0]);
    assert.throws(() => verifyRefillSeat(cartridge, blind, blindPose.toArray()), /overlaps/);
    const narrowLands = measureRefillSurfaces(narrow, "narrow");
    const [mouth] = refillOpenings(narrowLands, solidBounds(narrow));
    const tightPose = seatRefill(project, "donor", mouth);
    near(refillSnapClearance(shafts, narrowLands, tightPose).clearance, -.1, 1e-6, "small shank bore");
    assert.throws(() => verifyRefillSeat(cartridge, narrow, tightPose.toArray()), /overlaps/);
    assert.throws(() => seatRefill(project, "donor", {...mouth,diameter:6}), /collar/);

    const transform = new Matrix4().makeRotationZ(.6).setPosition(20,35,-7);
    const turned = positioned(barrel, transform.toArray());
    try {
      const holes = refillOpenings(measureRefillSurfaces(turned, "turned"), solidBounds(turned));
      assert.equal(holes.length, 2, "offset oblique import");
      const placement = seatRefill(project, "donor", holes.find(o => o.end === "start"));
      const tip = new Vector3(132,0,0).applyMatrix4(placement);
      near(tip.distanceTo(new Vector3(10,0,0).applyMatrix4(transform)), 0, 1e-6, "tip in oblique opening");
      verifyRefillSeat(cartridge, turned, placement.toArray());
    } finally { turned.delete(); }
  } finally { releaseBodies(solids); }
  console.log("PASS both refill seating directions, donor shoulder, oblique bores, blind bottoms, end wall and shank interference.");
} finally { await api.close(); }
