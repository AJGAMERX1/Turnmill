import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runtime,
  near,
  save,
  xfail,
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
    await xfail(
      "SYS-001",
      "Named angular limit breaks clearance worker and assembled drawing",
      async () => {
        let result, diagnostic, drawError;
        const copy = structuredClone(request);
        try {
          result = await checkPair(bodies, ids, copy);
        } catch (e) {
          diagnostic = e.message;
        }
        try {
          const draw = prepareDrawing(
            structuredClone({
              features: model.features,
              values: model.values,
              joints: cfg,
              modeled: false,
            }),
          );
          draw.dispose();
        } catch (e) {
          drawError = e.message;
        }
        await save("SYS-001/measurements.json", {
          hingePose: buildPoses(ids, cfg, { moving: [45] }, model.values),
          reference: direct,
          workerResult: result,
          workerError: diagnostic,
          drawingError: drawError,
        });
        for (const e of [diagnostic, drawError])
          if (e && e !== "Expected a angle value.")
            throw Error("Unexpected worker diagnostic: " + e);
        if (!diagnostic && result?.status !== "clear")
          throw Error("Unexpected clearance result " + JSON.stringify(result));
        assert.equal(
          drawError,
          undefined,
          "Assembled drawing worker should project both parts; got " +
            drawError,
        );
        assert.equal(
          result?.status,
          "clear",
          "A 45° pose separated by 6.00 mm should pass in the worker; got " +
            (diagnostic || result?.status),
        );
      },
    );
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
  await xfail(
    "SYS-002",
    "Rotated flat engraving silently clips the requested artwork",
    async () => {
      let m;
      try {
        [m] = await measureProject(api, engraved);
      } catch (e) {
        if (!/fit|footprint|outside|stock/i.test(e.message)) throw e;
        return;
      }
      const removed = 80 - m.volume;
      await save("SYS-002/measurements.json", {
        stockVolume: 80,
        designArea: 12,
        requestedDepth: 0.2,
        expectedRemoved: 2.4,
        actualRemoved: removed,
        shape: m,
      });
      if (Math.abs(removed - 2.4) > 0.0024 && Math.abs(removed - 1.6) > 0.0016)
        throw Error("Different engraving discrepancy: " + removed);
      near(
        removed,
        2.4,
        0.0024,
        "Complete 6 × 2 mm graphic cut (or reject placement)",
      );
    },
  );
  if (process.env.QA_EXPORT_SYS002) {
    const dir = process.env.QA_EXPORT_SYS002;
    await mkdir(dir, { recursive: true });
    const { features } = await evaluateModel(engraved);
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
