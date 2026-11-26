import assert from "node:assert/strict";
import { makeBox, makeCylinder, measureVolume } from "replicad";
import { Matrix4, Vector3 } from "three";
import { geometry, near, project, runtime } from "../tests/systems/runtime.mjs";

const api = await runtime();
try {
  const { barrelEnd, createThreadedCone } = await api.load("threadedCone");
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, exportBodies, releaseBodies } = await api.load("geometry");
  const { collectFitSurfaces } = await api.load("fitSurfaces");
  const { importSolidFile } = await api.load("exchangeSolids");
  const { bodyIds, buildPoses } = await api.load("kinematics");
  const { resolveThreadMates } = await api.load("threadMates");
  const { positioned } = await api.load("motionGeometry");

  // The raised lug shifts the bounding-box center while leaving both turned ends intact.
  const shaft = makeCylinder(5, 32, [17, -9, 20], [0, 0, 1]);
  const collar = makeCylinder(6, 6, [17, -9, 32], [0, 0, 1]);
  const lug = makeBox([22, -10, 33], [25, -8, 37]);
  const pilot = makeCylinder(3.5, 32, [17, -9, 20], [0, 0, 1]);
  const stepped = shaft.fuse(collar);
  const lugged = stepped.fuse(lug);
  const blank = lugged.cut(pilot);
  [shaft, collar, lug, pilot, stepped, lugged].forEach(s => s.delete());
  const step = exportBodies([{ name: "Offset sleeve", shape: blank }], "step");
  blank.delete();

  const imported = await importSolidFile("step", step, "Offset sleeve");
  const stock = imported[0].shape;
  try {
    const bounds = geometry(stock).bbox;
    assert((bounds[0][0] + bounds[1][0]) / 2 > 17.5);
    const lands = collectFitSurfaces(stock, "barrel", true);
    const source = { id: "barrel", sketchId: "", name: "Offset sleeve", kind: "import", operation: "new",
      amount: "0", suppressed: false, sourceId: "step", sourceIndex: 0 };
    const native = project([], [source], { importedFiles: [{ id: "step", format: "step", name: "sleeve.step",
      data: Buffer.from(await step.arrayBuffer()).toString("base64"), bodies: [{ name: "Offset sleeve", brep: stock.serialize() }] }] });
    for (const end of ["start", "end"]) {
      const rim = barrelEnd(lands, "Z", end);
      assert(rim);
      near(rim.centerline[0], 17, 1e-7, "first transverse coordinate");
      near(rim.centerline[1], -9, 1e-7, "second transverse coordinate");
      near(rim.outside, 10, 1e-7, "outside diameter");
      near(rim.bore, 7, 1e-7, "bore diameter");
      const { project: next, coneId } = createThreadedCone(native, source.id, rim, {
        end, size: "M8 × 0.75", length: "2.25 mm", coneLength: "15 mm", tipDiameter: "3.5 mm",
        opening: "2.5 mm", allowance: "0.10 mm", mode: "modeled", backWall: "2 mm",
      });
      const model = await evaluateModel(next);
      const bodies = buildBodies(model.features);
      try {
        const ids = bodyIds(model.features);
        const frames = bodies.flatMap(b => b.threadFrames ?? []);
        const female = frames.find(f => f.side === "internal"), male = frames.find(f => f.side === "external");
        assert.equal(female.axis, "Z");
        assert.equal(male.axis, "X");
        near(female.entrance[0], 17, 1e-7, "socket at measured axis in X");
        near(female.entrance[1], -9, 1e-7, "socket at measured axis in Y");
        near(female.entrance[2], rim.station, 1e-7, "socket at selected end");
        const joints = resolveThreadMates(next.workspaces.joints, frames, model.values, ids);
        const sign = end === "end" ? 1 : -1;
        for (const degrees of [0, 360 * sign]) {
          const pose = buildPoses(ids, joints, { [coneId]: [degrees] }, model.values);
          const matrix = pose[ids.indexOf(coneId)];
          const origin = new Vector3(...male.entrance).applyMatrix4(new Matrix4().fromArray(matrix));
          near(origin.x, 17, 1e-7, "assembled cone coaxial in X");
          near(origin.y, -9, 1e-7, "assembled cone coaxial in Y");
          near(origin.z, rim.station - sign * 2.25 + degrees / 360 * .75, 1e-7, "engaged depth and screw travel");
          const placed = positioned(bodies[1].shape, matrix);
          try {
            const intersection = bodies[0].shape.intersect(placed);
            try { near(measureVolume(intersection), 0, 1e-6, "modeled thread and shoulder interference"); }
            finally { intersection.delete(); }
          } finally { placed.delete(); }
        }
      } finally { releaseBodies(bodies); }
    }
  } finally { releaseBodies(imported); }
  console.log("PASS STEP-imported offset Z barrel, measured sockets, coaxial modeled cone, seated and one-turn clearance at both ends");
} finally { await api.close(); }
