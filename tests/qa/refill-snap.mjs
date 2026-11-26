import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Matrix4, Vector3 } from "three";
import { appUrl, measure, openBrowser } from "./browser.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";

const barrel = {
  version: 1, id: "refill-seat-test", name: "Turned donor sleeve", parameters: [],
  sketches: [{ id: "profile", name: "Sleeve profile", constraints: [],
    points: [[20, 2.05], [20, 5], [155, 5], [155, 2.05]].map(([x, y]) => ({ x: String(x), y: String(y) })) }],
  features: [{ id: "sleeve", name: "Test sleeve", kind: "revolve", operation: "new",
    amount: "360 deg", suppressed: false, sketchId: "profile" }],
};

function pose(state, id) {
  const index = state.joints.ids.indexOf(id);
  assert(index >= 0, "Body is present in the assembly");
  return new Matrix4().fromArray(state.joints.matrices[index]);
}
function near(actual, expected, label) {
  assert(Math.abs(actual - expected) < 1e-6, label + ": expected " + expected + ", observed " + actual);
}
function sameMatrix(a, b) {
  a.elements.forEach((value, i) => near(value, b.elements[i], "Assembly transform " + i));
}
async function stlSpan(page, axis) {
  await button(page, "Export").click();
  const next = page.waitForEvent("download");
  await page.getByRole("button", { name: /STL mesh/ }).click();
  const stl = await readFile(await (await next).path());
  const triangles = stl.readUInt32LE(80);
  assert(triangles > 0 && stl.length === 84 + 50 * triangles);
  let lo = Infinity, hi = -Infinity;
  for (let face = 0; face < triangles; face++) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const coordinate = stl.readFloatLE(84 + 50 * face + 12 + 12 * vertex + 4 * axis);
      lo = Math.min(lo, coordinate);
      hi = Math.max(hi, coordinate);
    }
  }
  return [lo, hi];
}

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1390, height: 930 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const selectComponent = async id => field(page, "Component").selectOption(id);
  const tab = name => page.getByRole("tab", { name, exact: true });
  async function openProject(project) {
    await field(page, "Open Turnmill project file").setInputFiles({
      name: "sleeve.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.locator(".project-trigger").filter({ hasText: project.name }).waitFor();
    await ready(page);
  }
  async function editPlacement(label, value) {
    const input = field(page, label);
    if (!await input.isVisible()) await page.getByText("Position & rotation", { exact: true }).click();
    await input.fill(value);
    await input.press("Enter");
  }
  await page.goto(appUrl);
  await saved(page);
  await openProject(barrel);
  await button(page, "Refills").click();
  const library = page.getByRole("dialog", { name: "Refill library" });
  await field(library, "Refill family").selectOption("bic-round-stic");
  await button(library, "Reverse refill").click();
  await button(library, "Insert refill").click();
  await library.waitFor({ state: "hidden" });
  await ready(page);
  const inserted = await measure(page);
  const donor = Object.values(inserted.project.workspaces.refills)[0];
  assert.equal(donor.reversed, true);
  const id = donor.bodyId;
  await tab("Assembly").click();
  await selectComponent("sleeve");
  await editPlacement("Position X", "41 mm");
  await editPlacement("Position Y", "13 mm");
  await editPlacement("Rotation Z", "90 deg");
  await selectComponent(id);
  assert.equal(await field(page, "Joint").inputValue(), "free");
  await editPlacement("Position Z", "24 mm");
  const original = await measure(page);
  near(pose(original, id).elements[14], 24, "Free refill position");
  const snap = button(page, "Snap to fit");
  const opening = field(page, "Bore opening");
  const start = opening.locator("option").filter({ hasText: "Start" });
  await start.waitFor({ state: "attached" });
  assert.match(await opening.locator("option:checked").textContent(), /End/, "Reversed donor initially favors the far mouth");
  await opening.selectOption(await start.getAttribute("value"));
  await snap.click();
  const release = button(page, "Release to free move");
  await release.waitFor();
  const seated = await measure(page);
  assert.equal(seated.project.workspaces.joints[id].parent, "sleeve");
  // Compare the actual transformed donor seat, tail and tip to the sleeve's local geometry.
  // Round Stic tip-to-tail is 132 mm. Flipping the solid moves its shoulder to X=122.
  const relative = pose(seated, "sleeve").invert().multiply(pose(seated, id));
  const shoulder = new Vector3(122, 0, 0).applyMatrix4(relative);
  const tip = new Vector3(132, 0, 0).applyMatrix4(relative);
  const tail = new Vector3(0, 0, 0).applyMatrix4(relative);
  near(shoulder.x, 20, "Collar seats against chosen opening");
  near(tip.x, 10, "Tip projects beyond opening");
  near(tail.x, 142, "Tail lies inside sleeve");
  for (const point of [shoulder, tip, tail]) near(Math.hypot(point.y, point.z), 0, "Refill axis is centered");
  await button(page, "Undo").click();
  await snap.waitFor();
  sameMatrix(pose(await measure(page), id), pose(original, id));
  await button(page, "Redo").click();
  await release.waitFor();
  sameMatrix(pose(await measure(page), id), pose(seated, id));
  await selectComponent("sleeve");
  await editPlacement("Position Y", "28 mm");
  const moved = await measure(page);
  sameMatrix(pose(moved, "sleeve").multiply(relative), pose(moved, id));
  near(pose(moved, id).elements[13], pose(seated, id).elements[13] + 15, "Moving the sleeve carries the refill");
  await button(page, "Apply to All parts").click();
  await tab("All parts").waitFor();
  assert.equal(await tab("All parts").getAttribute("aria-selected"), "true");
  const applied = await measure(page);
  for (const part of ["sleeve", id])
    sameMatrix(new Matrix4().fromArray(applied.project.workspaces.allPartsPose[part]), pose(moved, part));
  // A 90° turn around Z makes the barrel's X axis the exported world's Y axis.
  const expectedY = [28 + 10, 28 + 155];
  assert.deepEqual(await stlSpan(page, 1), expectedY, "All parts STL includes the seated refill and the barrel placement");
  await tab("BIC Round Stic donor").click();
  assert.deepEqual(await stlSpan(page, 0), [0, 132], "The individual donor tab exports in model coordinates");
  await saved(page);
  await page.reload();
  await saved(page);
  const reopened = await measure(page);
  assert.deepEqual(reopened.project.workspaces.allPartsPose, applied.project.workspaces.allPartsPose);
  await tab("Assembly").click();
  await selectComponent(id);
  await release.waitFor();
  sameMatrix(pose(await measure(page), id), pose(moved, id));
  await release.click();
  await snap.waitFor();
  assert.equal(await field(page, "Joint").inputValue(), "free");
  const released = await measure(page);
  sameMatrix(pose(released, id), pose(moved, id));
  await editPlacement("Position Z", "32 mm");
  const floated = await measure(page);
  near(pose(floated, id).elements[14], 32, "Unseated refill moves independently");
  sameMatrix(pose(floated, "sleeve"), pose(released, "sleeve"));
  const tight = structuredClone(inserted.project);
  tight.id = "small-refill-bore";
  tight.name = "Undersized sleeve";
  tight.sketches[0].points[0].y = tight.sketches[0].points[3].y = "1";
  await openProject(tight);
  await tab("Assembly").click();
  await selectComponent(id);
  await page.getByRole("alert").filter({ hasText: "bore is too small" }).waitFor();
  assert(await snap.isDisabled());
  assert.equal(await field(page, "Joint").inputValue(), "free", "Rejected fits leave an independent refill");
  await openProject({ ...seated.project, id: "cap-over-seated-donor", name: "Cap over seated donor" });
  await tab("Test sleeve").click();
  await button(page, "Threads").click();
  const threads = page.getByRole("dialog", { name: "Threads" });
  await button(threads, "Screw-on cap").click();
  assert.equal(await field(threads, "Front end").inputValue(), "start", "The cap covers the selected writing end of the reversed donor");
  await field(threads, "Thread size").selectOption({ label: "M8 × 0.75" });
  await field(threads, "Thread geometry").selectOption("cosmetic");
  await button(threads, "Create threaded cap").click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector(".thread-pair-dialog");
    return !dialog || !!dialog.querySelector('[role="alert"]')?.textContent;
  }, null, { timeout: 180000 });
  assert.deepEqual(await threads.getByRole("alert").allTextContents(), []);
  await ready(page);
  const capped = await measure(page);
  assert.equal(capped.bodies.length, 3);
  const mounts = capped.project.features.find(f => f.id === "sleeve").finishes.filter(f => f.preparation === "flush");
  assert.deepEqual(mounts.map(f => f.end).sort(), ["end", "start"]);
  assert.equal(capped.project.workspaces.joints[id].refillSnap, true);
  assert.equal(capped.project.workspaces.joints[id].parent, "sleeve");
  sameMatrix(new Matrix4().fromArray(capped.project.workspaces.joints[id].mount), relative);
  assert.deepEqual(errors, []);
  console.log("PASS reversed donor snap, carried motion, undo/redo, All parts and local STL bounds, saved pose, free release, undersized bore rejection and cap over the writing tip");
} finally { await browser.close(); }
