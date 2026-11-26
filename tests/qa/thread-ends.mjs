import assert from "node:assert/strict";
import { appUrl, measure, openBrowser } from "./browser.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";

function turnedPart(id, name, coordinates) {
  const sketch = { id: id + "-profile", name: name + " profile", constraints: [],
    points: coordinates.map(([x, y]) => ({ x: String(x), y: String(y) })) };
  return { sketch, feature: { id, name, kind: "revolve", operation: "new", amount: "360 deg",
    sketchId: sketch.id, suppressed: false } };
}

const cone = turnedPart("cone", "Grip cone", [[0, 1.5], [0, 6], [18, 3.5], [18, 1.5]]);
const cap = turnedPart("cap", "Pen cap", [[23, 2], [23, 7], [35, 7], [35, 2]]);
const project = { id: "quick-thread-ends", version: 1, name: "Cone and cap", parameters: [],
  sketches: [cone.sketch, cap.sketch], features: [cone.feature, cap.feature] };
const near = (actual, expected) => assert(Math.abs(actual - expected) < 2e-5, `${actual} differs from ${expected}`);

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await saved(page);
  async function openProject(document) {
    await field(page, "Open Turnmill project file").setInputFiles({
      name: "thread-test.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
    });
    await page.locator(".project-trigger").filter({ hasText: document.name }).waitFor();
    await ready(page);
  }
  await openProject(project);
  const before = await measure(page);
  async function threadEnd(name) {
    await page.locator(".history-list .tree-item").filter({ has: page.getByText(name, { exact: true }) })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Threads", exact: true }).click();
    await button(page.getByRole("dialog", { name: /^Threads/ }), "Thread one part").click();
    return page.getByRole("dialog", { name: "Thread end · " + name, exact: true });
  }
  async function apply(dialog) {
    await button(dialog, "Apply thread").click();
    await dialog.waitFor({ state: "hidden", timeout: 180000 });
    await ready(page);
    const state = await measure(page);
    assert.equal(state.valid, true);
    assert.deepEqual(state.bodies.map(body => body.solids), [1, 1]);
    return state;
  }

  const coneDialog = await threadEnd("Grip cone");
  await field(coneDialog, "Thread placement").selectOption("tenon");
  await field(coneDialog, "End").selectOption("start");
  await field(coneDialog, "Thread size").selectOption({ label: "M8 × 1" });
  await field(coneDialog, "Threaded length").fill("3 mm");
  await field(coneDialog, "Geometry").selectOption("cosmetic");
  await button(coneDialog, "Preview").click();
  await coneDialog.locator('.finish-form[data-preview="ready"]').waitFor({ timeout: 180000 });
  assert.equal((await measure(page)).project.features[0].finishes, undefined, "preview leaves the document unmodified");
  const withTenon = await apply(coneDialog);
  const male = withTenon.project.features[0].finishes[0];
  assert.equal(male.side, "external");
  assert.equal(male.end, "start");
  near(withTenon.bodies[0].bbox[0][0], -3);
  near(withTenon.bodies[0].volume - before.bodies[0].volume, Math.PI * (4 ** 2 - 1.5 ** 2) * 3);
  near(withTenon.bodies[1].volume, before.bodies[1].volume);
  assert.deepEqual(withTenon.project.sketches, before.project.sketches);

  const capDialog = await threadEnd("Pen cap");
  const source = field(capDialog, "Copy mating thread");
  await source.selectOption("cone/" + male.id);
  assert.equal(await field(capDialog, "Thread placement").inputValue(), "socket");
  assert.equal(await field(capDialog, "Thread size").inputValue(), "M8 × 1");
  assert.equal(await field(capDialog, "Threaded length").inputValue(), "3 mm");
  await field(capDialog, "End").selectOption("start");
  await field(capDialog, "Geometry").selectOption("cosmetic");
  await field(capDialog, "Threaded length").fill("50 mm");
  await button(capDialog, "Apply thread").click();
  await capDialog.getByRole("alert").waitFor({ timeout: 180000 });
  assert.deepEqual((await measure(page)).project.features, withTenon.project.features, "failed machining preserves both parts");

  await field(capDialog, "Threaded length").fill("3 mm");
  const socket = await apply(capDialog);
  const female = socket.project.features[1].finishes[0];
  assert.equal(female.side, "internal");
  for (const key of ["diameter", "pitch", "hand"]) assert.equal(female[key], male[key]);
  const pilotRadius = 4 - 5 * Math.sqrt(3) / 16;
  near(before.bodies[1].volume - socket.bodies[1].volume, Math.PI * (pilotRadius ** 2 - 2 ** 2) * 3);
  for (const end of [0, 1]) for (const axis of [0, 1, 2])
    near(socket.bodies[1].bbox[end][axis], before.bodies[1].bbox[end][axis]);
  near(socket.bodies[0].volume, withTenon.bodies[0].volume);
  assert(socket.bodies[1].center[0] > before.bodies[1].center[0], "socket cut enters from the minimum-X face");

  await page.getByRole("tab", { name: "Pen cap", exact: true }).click();
  const capFinish = page.locator(".history-list .tree-item.nested").filter({ hasText: female.name });
  await capFinish.click();
  await field(capDialog, "End").selectOption("end");
  await field(capDialog, "Geometry").selectOption("modeled");
  const changed = await apply(capDialog);
  assert.equal(changed.project.features[1].finishes.length, 1);
  assert.equal(changed.project.features[1].finishes[0].id, female.id);
  assert.equal(changed.project.features[1].finishes[0].end, "end");
  assert(changed.bodies[1].volume < socket.bodies[1].volume, "modeled helical grooves remove more stock than the smooth pilot alone");
  assert(changed.bodies[1].center[0] < before.bodies[1].center[0], "edited thread cuts the maximum-X face");
  near(changed.bodies[0].volume, withTenon.bodies[0].volume);

  await button(page, "Undo").click();
  await ready(page);
  const restored = await measure(page);
  assert.deepEqual(restored.project.features, socket.project.features, "undo restores the complete previous finishing step");
  near(restored.bodies[1].volume, socket.bodies[1].volume);

  await button(page, "Assembly").click();
  await field(page, "Component").selectOption("cap");
  await button(page, "Mate threads").click();
  const mate = page.getByRole("dialog", { name: "Mate threads" });
  await mate.getByText(/One turn advances 1 mm/).waitFor();
  await mate.locator("label").filter({ hasText: /^Zero-angle placement/ }).locator("select").selectOption("entrances");
  await button(mate, "Connect threads").click();
  await field(page, "Drive value").fill("360 deg");
  await field(page, "Drive value").press("Enter");
  await page.getByText("Axial travel 1.000 mm", { exact: true }).waitFor();
  const barrel = turnedPart("barrel", "Pen barrel", [[0, 3.5], [0, 5], [127, 5], [127, 3.5]]);
  const single = { ...project, id: "paired-thread-test", name: "Screw-on cone fixture",
    sketches: [barrel.sketch], features: [barrel.feature] };
  await openProject(single);
  await button(page, "Part").click();
  const empty = await measure(page);
  near(empty.bodies[0].volume, Math.PI * (25 - 3.5 ** 2) * 127);
  await button(page, "Threads").click();
  const paired = page.getByRole("dialog", { name: /^Threads/ });
  await field(paired, "Barrel end").selectOption("end");
  await field(paired, "Thread size").selectOption({ label: "M8 × 0.75" });
  await field(paired, "Thread length").fill("3 mm");
  await field(paired, "Cone length").fill("15 mm");
  await field(paired, "Tip outside diameter").fill("3.5 mm");
  await field(paired, "Tip opening diameter").fill("2.5 mm");
  await field(paired, "Close back of barrel").check();
  await field(paired, "Back wall thickness").fill("2 mm");
  await field(paired, "Thread geometry").selectOption("cosmetic");
  await button(paired, "Create threaded cone").click();
  await paired.waitFor({ state: "hidden", timeout: 180000 });
  await ready(page);
  const finished = await measure(page);
  assert.equal(finished.valid, true);
  assert.deepEqual(finished.bodies.map(b => b.solids), [1, 1]);
  const newPart = finished.project.features.find(f => f.operation === "new" && f.id !== "barrel");
  assert(newPart && newPart.sketchId, "the generated cone is an independent parametric part");
  assert(finished.project.sketches.some(sketch => sketch.id === newPart.sketchId));
  await page.getByRole("tab", { name: newPart.name, exact: true }).waitFor();
  const threaded = finished.project.features.flatMap(f => f.finishes ?? []).filter(f => f.kind === "thread");
  assert.deepEqual(threaded.map(f => f.side).sort(), ["external", "internal"]);
  assert.equal(threaded[0].pitch, threaded[1].pitch);
  const threadInput = suffix => finished.project.parameters.find(p => p.name.endsWith(suffix));
  const major = threadInput("_major"), allowance = threadInput("_allowance");
  assert.equal(threaded.find(f => f.side === "internal").diameter, major.name);
  assert.equal(threaded.find(f => f.side === "external").diameter, major.name + " - " + allowance.name);
  near(finished.values[major.name], 8);
  const joint = finished.project.workspaces.joints[newPart.id];
  assert.equal(joint.kind, "screw");
  assert.equal(joint.parent, "barrel");
  const barrelBody = finished.bodies.find(b => b.name === "Pen barrel");
  const bore = 4 - 5 * Math.sqrt(3) * .75 / 16;
  near(barrelBody.volume, empty.bodies[0].volume + Math.PI * (3.5 ** 2 * 2 - (bore ** 2 - 3.5 ** 2) * 3));
  await button(page, "Assembly").click();
  await field(page, "Component").selectOption(newPart.id);
  await field(page, "Drive value").fill("360 deg");
  await field(page, "Drive value").press("Enter");
  await page.getByText("Axial travel 0.750 mm", {exact: true}).waitFor();
  await button(page, "Part").click();
  // One undo should remove the generated part, both operations, and connection.
  await button(page, "Undo").click();
  await ready(page);
  const reverted = await measure(page);
  assert.deepEqual(reverted.project.features, empty.project.features);
  assert.deepEqual(reverted.project.sketches, empty.project.sketches);
  assert.deepEqual(reverted.project.workspaces?.joints, empty.project.workspaces?.joints);
  near(reverted.bodies[0].volume, empty.bodies[0].volume);
  assert.deepEqual(errors, []);
  console.log("PASS cone and cap threads, bore and taper preservation, mate size copy, invalid drafts, modeled and cosmetic solids, end placement, undo, automatically paired barrel and cone, closed rear wall and screw travel.");
} finally { await browser.close(); }
