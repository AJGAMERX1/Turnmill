import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
process.env.TURNMILL_PROJECT_EVIDENCE ||= "test-evidence/phase2";
const { run, sample, stepExport } = await import("./support.mjs");
const { pen, drawing } = await import("./pen.mjs");

const result = await run("m10-acceptance", async (s) => {
  const checkpoints = [],
    components = ["Barrel", "Threaded cap", "Refill", "Pocket clip"];
  let threadId;
  async function checkpoint(session, stage) {
    const x = await sample(session, stage);
    assert.equal(x.project.name, "M10 twist pen");
    assert.equal(x.values.thread_major, 10);
    assert.equal(x.values.thread_pitch, 0.75);
    assert.equal(x.values.outer_diameter, 12.3);
    assert.deepEqual(
      x.bodies.map((b) => b.name),
      components,
    );
    assert(x.bodies.every((b) => b.valid && b.solids === 1));
    const [thread, knurl, mark] = x.project.features[0].finishes;
    assert.equal(thread.mode, "modeled");
    threadId ??= thread.id;
    assert.equal(thread.id, threadId, "Same barrel thread remains throughout");
    if (!["M10-barrel", "01-threaded-pen"].includes(stage))
      assert.equal(knurl?.kind, "knurl");
    if (!["M10-barrel", "01-threaded-pen", "02-knurled-grip"].includes(stage)) {
      assert.equal(mark.text, "ANA");
      assert.equal(mark.depth, "0.12 mm");
    }
    if (["04-mated", "05-travel"].includes(stage)) {
      assert.equal(x.joints.selected, "pen-cap");
      assert.equal(x.joints.current, 360);
      assert.equal(x.joints.lead, 0.75);
      assert.deepEqual([x.joints.min, x.joints.max], [0, 720]);
    }
    checkpoints.push({
      stage,
      mode: x.mode,
      project: x.project.name,
      threadId,
      threadMajorMm: x.values.thread_major,
      pitchMm: x.values.thread_pitch,
      solids: x.bodies.length,
    });
    return x;
  }
  await pen(s, { keepM10: true, checkpoint });
  await stepExport(s, "installed-M10-pen");
  const clearance = await readFile(join(s.dir, "clearance.txt"), "utf8");
  const lowerBound = clearance.match(/gap ≥ ([\d.]+) mm/);
  assert(lowerBound && Number(lowerBound[1]) > 0, clearance);
  await drawing(s, null, { currentProject: true, checkpoint });
  const project = JSON.parse(
    await readFile(join(s.dir, "drawing-set.turnmill"), "utf8"),
  );
  assert.equal(project.name, "M10 twist pen");
  assert.equal(
    project.parameters.find((p) => p.name === "outer_diameter").expression,
    "12.3 mm",
  );
  assert.equal(project.features[0].finishes[0].id, threadId);
  assert.equal(project.features[0].finishes.at(-1).text, "ANA");
  assert.deepEqual(project.workspaces.jointPose["pen-cap"], [360]);
  await writeFile(
    join(s.dir, "acceptance.json"),
    JSON.stringify(
      {
        name: project.name,
        components,
        clearance,
        minimumBoundMm: Number(lowerBound[1]),
        travelDeg: [0, 720],
        steps: checkpoints,
      },
      null,
      2,
    ) + "\n",
  );
});
console.log(result.name, result.status, result.message);
if (result.status !== "PASS") process.exitCode = 1;
