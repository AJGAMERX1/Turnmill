import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Matrix4, Vector3 } from "three";
import { createServer } from "vite";
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
const near = (a, b, message) =>
  assert.ok(Math.abs(a - b) < 1e-8, `${message}: ${a} vs ${b}`);
try {
  const {
    defaultJoint,
    limits,
    buildPoses,
    placementMatrix,
    placementFromMatrix,
    isFloating,
    assemblyCamReadings,
    camTravelSpeed,
    jointTravelProblem,
  } = await server.ssrLoadModule("/src/kinematics.ts");
  const { camDefaults, evaluateCam, camSample } =
    await server.ssrLoadModule("/src/camLaw.ts");
  const joint = (kind, extra = {}) => ({
    ...defaultJoint(),
    kind,
    min: "-360",
    max: "360",
    ...extra,
  });
  function matrix(j, coords) {
    return new Matrix4().fromArray(
      buildPoses(["part"], { part: j }, { part: coords }, {})[0],
    );
  }
  function at(m, point, expected, label) {
    const xyz = new Vector3(...point).applyMatrix4(m).toArray();
    xyz.forEach((n, i) => near(n, expected[i], label));
  }
  assert.equal(isFloating(), true, "A new, unconnected body can be moved");
  assert.equal(isFloating(defaultJoint()), false, "Existing explicit fixed joints stay grounded");
  const placement = { position: ["span / 2", "2 mm", "-1 mm"], rotation: ["0", "0", "90 deg"] };
  const placed = {
    base: joint("fixed", { floating: true, placement }),
    slide: joint("slider", { parent: "base", axis: "X" }),
  };
  const positioned = buildPoses(["base", "slide"], placed, { slide: [3] }, { span: 20 })
    .map((v) => new Matrix4().fromArray(v));
  at(positioned[0], [1, 0, 0], [10, 3, -1], "free world position and rotation");
  at(positioned[1], [0, 0, 0], [10, 5, -1], "slider travels along the rotated parent's axis");
  at(placementMatrix(placement, { span: 40 }), [1, 0, 0], [20, 3, -1], "placement follows a named dimension");
  const release = placementFromMatrix(positioned[1]);
  const detached = matrix(joint("fixed", { floating: true, placement: release }), []);
  detached.elements.forEach((v, i) => near(v, positioned[1].elements[i], "detaching preserves a driven world pose"));
  const { canSnapRefill, makeRefillSnapJoint } = await server.ssrLoadModule("/src/assemblyRefillSnap.ts");
  const mount = new Matrix4().makeRotationY(Math.PI).setPosition(3, 2, 1);
  const snapped = makeRefillSnapJoint(placed, "refill", "slide", mount);
  const snappedTree = { ...placed, refill: snapped };
  const posedRefill = (travel) => new Matrix4().fromArray(
    buildPoses(["base", "slide", "refill"], snappedTree, { slide: [travel] }, { span: 20 })[2],
  );
  at(posedRefill(3), [1, 0, 0], [8, 7, 0], "seated reversed refill follows its moving barrel");
  at(posedRefill(4), [1, 0, 0], [8, 8, 0], "seated refill travels with the parent joint");
  const released = matrix(joint("fixed", { floating: true, placement: placementFromMatrix(posedRefill(4)) }), []);
  released.elements.forEach((v, i) => near(v, posedRefill(4).elements[i], "release keeps the seated world pose"));
  assert.ok(canSnapRefill(snapped), "a snapped refill can choose another opening");
  assert.throws(() => makeRefillSnapJoint(snappedTree, "slide", "base", mount), /already has a joint/);
  assert.throws(() => makeRefillSnapJoint({ base: joint("fixed", { parent: "refill" }) }, "refill", "base", mount), /loop/);
  assert.throws(() => makeRefillSnapJoint({}, "refill", "base", new Matrix4().makeScale(2, 2, 2)), /invalid placement/);
  for (const rotation of [["23", "-67", "89"], ["8", "90", "-28"], ["-31", "-90", "12"]]) {
    const m = placementMatrix({ position: ["1", "2", "3"], rotation }, {});
    const roundTrip = placementMatrix(placementFromMatrix(m), {});
    roundTrip.elements.forEach((n, i) => near(n, m.elements[i], "round-trip arbitrary XYZ rotation"));
  }
  at(
    matrix(joint("fixed", { offset: ["1", "2", "3"] }), [7]),
    [1, 1, 1],
    [2, 3, 4],
    "fixed offset",
  );
  at(
    matrix(joint("revolute", { axis: "Z", origin: ["1", "2", "0"] }), [90]),
    [2, 2, 0],
    [1, 3, 0],
    "offset revolute pivot",
  );
  at(
    matrix(joint("slider", { axis: "Y", max: "4 mm" }), [15]),
    [0, 0, 0],
    [0, 4, 0],
    "slider stops",
  );
  at(
    matrix(joint("cylindrical", { axis: "Z" }), [3, 90]),
    [1, 0, 0],
    [0, 1, 3],
    "cylindrical two freedoms",
  );
  at(
    matrix(joint("ball"), [90, 0, 90]),
    [1, 0, 0],
    [0, 0, 1],
    "ball rotations in joint frame",
  );
  at(
    matrix(joint("planar", { axis: "Z" }), [2, 3, 90]),
    [1, 0, 0],
    [2, 4, 0],
    "planar slide and rotation",
  );
  at(
    matrix(
      joint("screw", { axis: "Z", pitch: "0.5 mm", starts: "2", hand: -1 }),
      [90],
    ),
    [1, 0, 0],
    [0, 1, -0.25],
    "two-start left-hand screw",
  );
  assert.throws(
    () => limits(joint("slider", { min: "5", max: "4" }), 0, {}),
    /maximum/,
  );
  assert.throws(
    () =>
      buildPoses(
        ["a", "b"],
        {
          a: joint("fixed", { parent: "b" }),
          b: joint("fixed", { parent: "a" }),
        },
        {},
        {},
      ),
    /loop/,
  );
  const law = camDefaults({ cam_lift: 1.2 }),
    values = { cam_lift: 1.2 };
  const cam = {
    driver: "cam",
    law,
    datum: "0 mm",
    direction: 1,
    phase: "0 deg",
    springEnabled: true,
  };
  const joints = {
    cam: joint("revolute"),
    refill: joint("slider", { min: "-4", max: "4", cam }),
    clip: joint("fixed", { parent: "refill", offset: ["0", "3", "0"] }),
  };
  const ids = ["cam", "refill", "clip"];
  function reading(config, angle, params = values) {
    return assemblyCamReadings(
      ids,
      config,
      { cam: [angle], refill: [3.9] },
      params,
    )[0];
  }
  for (const [angle, lift, force] of [
    [0, 0, 0.6],
    [16, 0.6, 1.02],
    [35, 1.2, 1.44],
    [60, 0.6, 1.02],
    [90, 0, 0.6],
    [-74, 0.6, 1.02],
  ]) {
    const r = reading(joints, angle);
    near(r.position, lift, "cam position");
    near(r.sample.spring, force, "closing force");
    assert.equal(r.error, "");
    const matrices = buildPoses(
      ids,
      joints,
      { cam: [angle], refill: [3.9] },
      values,
    );
    near(matrices[1][12], lift, "slider follows instead of manual input");
    near(matrices[2][12], lift, "follower child inherits motion");
    near(matrices[2][13], 3, "child offset");
  }
  near(
    reading(joints, 16, { cam_lift: 2 }).position,
    1,
    "named lift parameter",
  );
  const linked = (p, driver = joints.cam) => ({
    ...joints,
    cam: driver,
    refill: { ...joints.refill, cam: { ...cam, ...p } },
  });
  near(
    reading(linked({ datum: "1 mm", direction: -1, phase: "16 deg" }), 0)
      .position,
    0.4,
    "reversed and phased follower with datum",
  );
  assert.equal(reading(linked({ springEnabled: false }), 16).sample.spring, 0);
  assert.equal(
    reading(linked({ springEnabled: false, law: { ...law, load: "0 N" } }), 0)
      .sample.state,
    "Zero closing force",
  );
  assert.match(
    reading(linked({ law: { ...law, load: "-3 N" } }), 16).error,
    /loses contact/,
  );
  assert.match(
    reading(linked({ law: { ...law, compression: ".9 mm" } }), 16).error,
    /spring/i,
  );
  assert.match(
    reading(linked({ law: { ...law, travel: ".2 mm" } }), 16).error,
    /travel/i,
  );
  assert.throws(
    () => buildPoses(ids, linked({ datum: "4 mm" }), { cam: [16] }, values),
    /slider limits/,
  );
  assert.throws(() => reading(linked({}, joint("fixed")), 0), /rotate the cam/);
  assert.throws(() => reading(linked({ driver: "gone" }), 0), /missing/);
  assert.throws(
    () => reading(linked({}, joint("revolute", { axis: "Y" })), 0),
    /same joint axis/,
  );
  const rotated = joint("revolute", {
    axis: "Y",
    mount: new Matrix4().makeRotationZ(-Math.PI / 2).toArray(),
  });
  near(
    reading(linked({}, rotated), 16).position,
    0.6,
    "driver axis after mount",
  );
  const cylinder = joint("cylindrical");
  const cyclic = linked({}, cylinder);
  const cr = assemblyCamReadings(ids, cyclic, { cam: [1, 16] }, values)[0];
  near(cr.position, 1.6, "cylindrical axial advance plus lift");
  near(cr.sample.spring, 1.72, "translated compression");
  near(
    camTravelSpeed(cyclic.refill, cylinder, 0, values),
    1,
    "cylindrical linear speed bound",
  );
  const screw = joint("screw", { pitch: "1 mm", starts: "2", hand: -1 });
  const screwCfg = linked({}, screw),
    fast = camTravelSpeed(screwCfg.refill, screw, 0, values);
  let prev = reading(screwCfg, -170);
  for (let angle = -169; angle <= 170; angle++) {
    const sample = reading(screwCfg, angle);
    assert.ok(
      Math.abs(sample.position - prev.position) <= fast + 1e-8,
      "speed bound encloses cam and screw translation",
    );
    prev = sample;
  }
  const stopAt = linked(
    {},
    joint("screw", {
      min: "44 deg",
      max: "76 deg",
      pitch: "3.6 mm",
      starts: "1",
    }),
  );
  stopAt.refill = { ...stopAt.refill, max: "1.644 mm" };
  for (const angle of [44, 60, 76])
    assert.equal(reading(stopAt, angle).error, "");
  assert.match(
    jointTravelProblem(ids, stopAt, {}, values, "cam", 0),
    /infeasible at 45.*slider limits/,
  );
  assert.equal(jointTravelProblem(ids, joints, {}, values, "cam", 0), "");
  const narrow = linked({
    law: {
      ...law,
      rise: "0.1 deg",
      high: "0 deg",
      returnAngle: "0.2 deg",
      load: "-1 N",
    },
  });
  assert.match(
    jointTravelProblem(ids, narrow, {}, values, "cam", 0),
    /loses contact/,
  );
  const swept = { ...cyclic, cam: { ...cylinder, min: "0", max: "6 mm" } };
  assert.match(
    jointTravelProblem(ids, swept, { cam: [0, 16] }, values, "cam", 0),
    /6 mm.*outside/,
  );
  const { springReading } = await server.ssrLoadModule("/src/springForce.ts");
  const spring = {
    zero: "reference",
    preload: "1 N",
    stiffness: "2 N/mm",
    maxCompression: "4 mm",
    direction: 1,
  };
  const springVars = { reference: 1 };
  const sprung = joint("slider", { min: "-10 mm", max: "6 mm", spring });
  const sr = springReading(spring, 3, springVars);
  near(sr.compression, 2.5, "compression at slider position");
  near(sr.restoringForce, -5, "restoring force points toward low position");
  near(
    springReading(spring, 0, springVars).force,
    0,
    "free spring cannot pull",
  );
  near(
    springReading({ ...spring, direction: -1 }, -1, springVars).restoringForce,
    5,
    "force with reversed direction",
  );
  assert.throws(
    () => buildPoses(["part"], { part: sprung }, { part: [6] }, springVars),
    /spring requires 5.5 mm/,
  );
  assert.match(
    jointTravelProblem(["part"], { part: sprung }, {}, springVars, "part", 0),
    /infeasible at 6 mm/,
  );
  assert.equal(
    jointTravelProblem(
      ["part"],
      { part: { ...sprung, max: "4 mm" } },
      {},
      springVars,
      "part",
      0,
    ),
    "",
  );
  near(
    buildPoses(["part"], { part: sprung }, { part: [3] }, springVars)[0][12],
    3,
    "loaded slider position",
  );
  const suspended = {
    ...joints,
    refill: { ...joints.refill, spring: { ...spring, stiffness: "0" } },
  };
  near(
    buildPoses(ids, suspended, { cam: [16] }, values)[1][12],
    0.6,
    "cam uses its own spring while linked",
  );
  const pic = await readFile(
    new URL("../examples/twist-pen.turnmill", import.meta.url),
    "utf8",
  );
  const pen = JSON.parse(pic);
  const penIds = pen.features
    .filter((f) => f.operation === "new")
    .map((f) => f.id);
  const penJoints = structuredClone(pen.workspaces.joints);
  penJoints["pen-refill"].cam = { ...cam, driver: "pen-cap" };
  const { resolveParameters } = await server.ssrLoadModule(
    "/src/expressions.ts",
  );
  const pv = { ...resolveParameters(pen.parameters), ...values };
  const turn = 16,
    pos = (turn * 0.75) / 360 + 0.6;
  const m = buildPoses(penIds, penJoints, { "pen-cap": [turn] }, pv);
  near(
    m[penIds.indexOf("pen-refill")][12],
    pos,
    "cap screw advances and drives the refill",
  );
  const linkedReading = assemblyCamReadings(
    penIds,
    penJoints,
    { "pen-cap": [turn] },
    pv,
  )[0];
  near(
    linkedReading.sample.spring,
    0.6 + 0.7 * pos,
    "spring force follows cap advance and cam rise",
  );
  const ll = evaluateCam(
    { ...law, preload: "2 lbf", rate: "1 lbf/in" },
    values,
  );
  near(camSample(ll, 0).spring, 2 * 4.4482216152605, "force units");
  console.log(
    "Passed seven joint types, travel limits, harmonic rise/dwell/return, actual pen cap–refill coupling, phased/reversed travel, inherited motion, spring preload and lift, loss of contact, independent screw/cylindrical advance, follower speed bounds, free-slider spring force, and coil-bind detection.",
  );
} finally {
  await server.close();
}
