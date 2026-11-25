import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runtime,
  near,
  save,
  feature,
  boxSketch,
  project,
  measureProject,
  geometry,
} from "./runtime.mjs";
const api = await runtime();
const { resolveParameters, evaluate } = await api.load("expressions"),
  { defaultJoint, buildPoses } = await api.load("kinematics");
const { checkPair } = await api.load("clearance"),
  { buildBodies, releaseBodies, exportBodies } = await api.load("geometry");
const { prepareDrawing } = await api.load("preparedDrawing"),
  { evaluateModel } = await api.load("buildModel");
try {
  const parameters = [
    { name: "hinge_limit", kind: "angle", expression: "180 deg" },
  ];
  const plate = feature("plate", "stock", 2);
  const pin = feature("moving", "leaf", 2);
  const cfg = {
    moving: {
      ...defaultJoint(),
      kind: "revolute",
      parent: "plate",
      axis: "X",
      min: "0 deg",
      max: "hinge_limit",
    },
  };
  const hinge = project(
    [boxSketch("stock", 0, 0, 4, 4), boxSketch("leaf", 10, 0, 14, 4)],
    [plate, pin],
    { parameters, workspaces: { joints: cfg } },
  );
  await save("SYS-001/angle-limit.turnmill", hinge);
  const model = await evaluateModel(hinge),
    ids = ["plate", "moving"];
  const bodies = buildBodies(model.features);
  try {
    const request = {
      id: "moving",
      pair: "plate",
      coordinate: 0,
      config: cfg,
      drivers: { moving: [45] },
      values: model.values,
      parameters,
      requiredGap: 1,
      range: false,
    };
    const direct = await checkPair(bodies, ids, request);
    assert.equal(direct.status, "clear");
    near(direct.sampledGap, 6, 0.01, "separation");
    const cloned = await checkPair(bodies, ids, structuredClone(request));
    assert.equal(cloned.status, "clear");
    near(cloned.sampledGap, 6, 0.01, "worker separation at 45 degrees");
    const drawing = prepareDrawing(
      structuredClone({
        features: model.features,
        values: model.values,
        parameters,
        joints: cfg,
        modeled: false,
      }),
    );
    try {
      assert.ok(drawing.base.assembly, "Expected a projected assembly sheet");
      await save("SYS-001/measurements.json", {
        hingePose: buildPoses(ids, cfg, { moving: [45] }, model.values),
        reference: direct,
        workerResult: cloned,
        assemblyProjected: true,
      });
    } finally {
      drawing.dispose();
    }
  } finally {
    releaseBodies(bodies);
  }
  const points = [
    [0, -0.5],
    [3, -0.5],
    [3, 0.5],
    [0, 0.5],
  ];
  const artwork = {
    width: 3,
    outlines: [
      { outer: points.map((p, i) => [p, points[(i + 1) % 4]]), holes: [] },
    ],
  };
  const mark = {
    id: "mark",
    name: "Rotated rectangle",
    kind: "mark",
    end: "start",
    content: "graphic",
    graphicName: "6 × 2 mm rectangle",
    artwork,
    text: "",
    method: "engrave",
    height: "2",
    depth: "0.2",
    offset: "1",
    rotation: "90 deg",
  };
  const engraved = project(
    [boxSketch("stock", 0, 0, 10, 4)],
    [{ ...plate, finishes: [mark] }],
  );
  await save("SYS-002/rotated-graphic.turnmill", engraved);
  await assert.rejects(
    () => measureProject(api, engraved),
    /artwork extends outside the flat face/i,
  );
  const supported = structuredClone(engraved);
  supported.features[0].finishes[0].rotation = "15 deg";
  const [supportedCut] = await measureProject(api, supported);
  near(80 - supportedCut.volume, 2.4, 0.0024, "Complete rotated graphic");
  await save("SYS-002/supported-graphic.turnmill", supported);
  await save("SYS-002/measurements.json", {
    rejectedRotationDegrees: 90,
    supportedRotationDegrees: 15,
    expectedRemoved: 2.4,
    actualRemoved: 80 - supportedCut.volume,
    shape: supportedCut,
  });
  if (process.env.QA_EXPORT_SYS002) {
    const dir = process.env.QA_EXPORT_SYS002;
    await mkdir(dir, { recursive: true });
    const { features } = await evaluateModel(supported);
    await writeFile(join(dir, "SYS-002.turnmill"), JSON.stringify(supported));
    const bodies = buildBodies(features);
    try {
      for (const format of ["step", "stl"])
        await writeFile(
          join(dir, "SYS-002." + format),
          Buffer.from(await exportBodies(bodies, format).arrayBuffer()),
        );
      await writeFile(
        join(dir, "SYS-002.native.json"),
        JSON.stringify(
          {
            model: "rotated graphic",
            expected: null,
            parts: bodies.map((b) => ({ name: b.name, ...geometry(b.shape) })),
          },
          null,
          2,
        ),
      );
    } finally {
      releaseBodies(bodies);
    }
  }
  const { evaluateFinish } = await api.load("finishingTypes");
  // Exercise advertised spelling and mathematical/physical boundaries separately from interpreting comma decimals.
  const values = resolveParameters([{ name: "length", expression: "20 mm" }]);
  const numeric = [];
  for (const [input, wanted] of [
    ["1/2 in", 12.7],
    ["length/2+3", 13],
    ["-3 mm", -3],
    ["0", 0],
    ["1e12 mm", 1e12],
    ["0.000001 mm", 0.000001],
  ]) {
    const got = evaluate(input, values);
    near(got, wanted, 1e-10, "numeric expression");
    numeric.push({ input, value: got });
  }
  for (const input of ["12,7", "", "abc", "2/0", "1e999"]) {
    let out;
    try {
      evaluate(input, values);
    } catch (e) {
      out = e.message;
    }
    assert(out);
    numeric.push({ input, rejected: out });
  }
  for (const d of ["0", "-1"])
    assert.throws(() =>
      evaluateFinish(
        {
          id: "hole",
          name: "hole",
          kind: "hole",
          end: "end",
          diameter: d,
          length: "1",
        },
        values,
      ),
    );
  await save("number-inputs.json", numeric);
} finally {
  await api.close();
}
