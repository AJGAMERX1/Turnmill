import assert from "node:assert/strict";
import { appUrl, measure, openBrowser } from "./browser.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";

function barrel(id, name, outside, start) {
  const inner = 3.5, outer = outside / 2, end = start + 125;
  const sketch = { id: id + "-profile", name: name + " profile", constraints: [],
    points: [[start, inner], [start, outer], [end, outer], [end, inner]]
      .map(([x, y]) => ({ x: String(x), y: String(y) })) };
  const feature = { id, name, kind: "revolve", operation: "new", amount: "360 deg", sketchId: sketch.id, suppressed: false };
  return { sketch, feature };
}

const sleeve = barrel("sleeve", "Pen barrel", 12, 0);
const spare = barrel("spare", "Spare barrel", 14, 200);
const single = { id: "energel-threads", name: "EnerGel threads", version: 1, parameters: [],
  sketches: [sleeve.sketch], features: [sleeve.feature] };

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const tab = name => page.getByRole("tab", { name, exact: true });
  const dialog = page.getByRole("dialog", { name: "Threads", exact: true });
  async function openProject(project) {
    await field(page, "Open Turnmill project file").setInputFiles({
      name: "energel.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.locator(".project-trigger").filter({ hasText: project.name }).waitFor();
    await ready(page);
  }
  await page.goto(appUrl);
  await saved(page);
  await openProject(single);
  await button(page, "Refills").click();
  const library = page.getByRole("dialog", { name: "Refill library" });
  await field(library, "Refill family").selectOption("energel-lr7");
  await button(library, "Reverse refill").click();
  await button(library, "Insert refill").click();
  await library.waitFor({ state: "hidden" });
  await ready(page);
  const inserted = (await measure(page)).project;
  const [refill] = Object.values(inserted.workspaces.refills);
  const donor = inserted.features.find(f => f.id === refill.bodyId);
  await tab(donor.name).click();
  await button(page, "Threads").click();
  await button(dialog, "Thread one part").click();
  const manual = page.getByRole("dialog", { name: "Thread end · Pen barrel", exact: true });
  await button(manual, "Cancel").click();
  await tab(donor.name).click();
  await button(page, "Threads").click();
  await button(dialog, "Screw-on cap").click();
  assert.equal(await field(dialog, "Cap outside diameter").inputValue(), "12 mm", "The selected refill uses the actual barrel end diameter");
  assert(!(await dialog.innerText()).includes("Front Ø0 mm"));
  assert(!["", "M2 × 0.4"].includes(await field(dialog, "Thread size").inputValue()));
  await dialog.getByRole("img", { name: "Section of domed screw-on cap" }).waitFor();
  const createCap = button(dialog, "Create threaded cap");
  const footer = await createCap.boundingBox();
  assert(footer && footer.y >= 0 && footer.y + footer.height <= page.viewportSize().height,
    "The create button must stay on screen on a short display");
  await field(dialog, "Thread geometry").selectOption("cosmetic");
  await createCap.click();
  await dialog.waitFor({ state: "hidden", timeout: 150000 });
  await ready(page);
  const capped = (await measure(page)).project;
  const [capId] = Object.keys(capped.workspaces.capMounts);
  assert.equal(capped.workspaces.joints[capId].parent, sleeve.feature.id);
  assert.deepEqual(capped.features.find(f => f.id === donor.id), donor);
  assert.deepEqual(capped.features.find(f => f.id === sleeve.feature.id).finishes
    .filter(f => f.kind === "thread").map(f => f.end).sort(), ["end", "start"]);

  await openProject({ ...inserted, id: "multiple-barrels", name: "Two barrels and a refill",
    features: [...inserted.features, spare.feature], sketches: [...inserted.sketches, spare.sketch] });
  await tab("Assembly").click();
  const component = field(page, "Component");
  await component.selectOption(donor.id);
  await measure(page);
  await component.blur();
  await page.keyboard.press("t");
  const picker = field(dialog, "Barrel");
  assert.equal(await picker.inputValue(), "", "A loose refill with two possible barrels requires an explicit selection");
  assert.deepEqual(await picker.locator('option:not([value=""])').allTextContents(), ["Pen barrel", "Spare barrel"]);
  assert(!(await picker.locator("option").allTextContents()).includes(donor.name));
  await picker.selectOption(spare.feature.id);
  await button(dialog, "Screw-on cap").click();
  assert.equal(await field(dialog, "Cap outside diameter").inputValue(), "14 mm");
  await button(dialog, "Cancel").click();
  assert.deepEqual((await measure(page)).project.features, [...inserted.features, spare.feature]);

  await tab("Assembly").click();
  await component.selectOption(donor.id);
  const opening = field(page, "Bore opening");
  const spareMouth = opening.locator("option").filter({ hasText: "Spare barrel" }).first();
  await opening.selectOption(await spareMouth.getAttribute("value"));
  await button(page, "Snap to fit").click();
  await button(page, "Release to free move").waitFor();
  await tab(donor.name).click();
  await button(page, "Threads").click();
  assert.equal(await picker.inputValue(), spare.feature.id, "A seated refill uses its actual parent barrel");
  await button(dialog, "Cancel").click();

  await openProject({ ...inserted, id: "refill-only", name: "EnerGel alone",
    features: [donor], sketches: inserted.sketches.filter(sketch => sketch.id === donor.sketchId) });
  await tab(donor.name).click();
  await button(page, "Threads").click();
  assert.equal(await field(dialog, "Cap outside diameter").count(), 0);
  assert.equal(await button(dialog, "Create threaded cap").count(), 0);
  assert(Number.parseFloat(await field(dialog, "Bore diameter").inputValue()) > 6.35);
  const outside = field(dialog, "Outside diameter");
  const starterDiameter = await outside.inputValue();
  await outside.fill("2 mm");
  await button(dialog, "Create barrel").click();
  await dialog.getByRole("alert").waitFor();
  assert.deepEqual((await measure(page)).project.features, [donor]);
  await outside.fill(starterDiameter);
  await button(dialog, "Create barrel").click();
  await button(dialog, "Screw-on cap").click();
  await dialog.getByRole("img", { name: "Section of domed screw-on cap" }).waitFor();
  const newStock = await measure(page);
  assert.equal(newStock.project.features.length, 2);
  assert.deepEqual(newStock.project.features.find(f => f.id === donor.id), donor);
  assert.equal(newStock.bodies.length, 2);
  await button(dialog, "Cancel").click();
  assert.deepEqual(errors, []);
  console.log("PASS EnerGel selection uses barrel measurements, creates both mounts on the barrel, offers target selection, and guides refill-only projects.");
} finally { await browser.close(); }
