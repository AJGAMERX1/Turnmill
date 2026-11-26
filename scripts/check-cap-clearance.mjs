import assert from "node:assert/strict";
import { project, runtime } from "../tests/systems/runtime.mjs";

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
  console.log("PASS exact front and posted cap clearance against a protruding refill and both mated barrel ends, modeled and cosmetic");
} finally { await api.close(); }
