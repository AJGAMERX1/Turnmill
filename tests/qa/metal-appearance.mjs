import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "three/examples/jsm/libs/fflate.module.js";
import { boxSketch, feature, project } from "../systems/runtime.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";
import { appUrl, openBrowser } from "./browser.mjs";

const tube = boxSketch("profile-one", 0, 2, 45, 5);
const cap = boxSketch("profile-two", 48, 0, 57, 5);
const blank = project([tube, cap], [
  { ...feature("tube", tube.id, "360 deg", "revolve"), name: "Custom tube" },
  { ...feature("cap", cap.id, "360 deg", "revolve"), name: "End button" },
], { id: "appearance-qa", name: "Finish samples" });

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(appUrl);
  await saved(page);
  await field(page, "Open Turnmill project file").setInputFiles({
    name: "synthetic.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(blank)),
  });
  await page.locator(".project-trigger").filter({ hasText: blank.name }).waitFor();
  await ready(page);
  await button(page, "Pen Studio").click();

  const bench = page.getByRole("complementary", { name: "Pen design bench" });
  const appearance = bench.getByRole("region", { name: "Appearance" });
  const active = field(appearance, "Part to finish");
  const selected = async name => assert.equal(await button(appearance, name).getAttribute("aria-pressed"), "true", name);
  const mass = () => bench.locator("dt", {hasText: "Modeled mass"}).locator("..").locator("dd").innerText();
  async function fileFrom(action) {
    const next = page.waitForEvent("download", { timeout: 120000 });
    await action.click();
    const file = await next;
    assert.equal(await file.failure(), null);
    return readFile(await file.path());
  }
  async function native() {
    await page.locator(".project-trigger").click();
    return JSON.parse(await fileFrom(page.getByRole("button", {name: /Save project file/})));
  }
  await active.selectOption("tube");
  const brassMass = await mass();
  await button(appearance, "Aluminum for Custom tube").click();
  await selected("Bare aluminum");
  const aluminumMass = await mass();
  assert(parseFloat(aluminumMass) < parseFloat(brassMass), "Changing the base metal updates the physical mass");
  const natural = await fileFrom(button(page, "Save PNG"));
  await button(appearance, "Blue anodizing").click();
  await selected("Blue anodizing");
  await button(appearance, "Brushed").click();
  await selected("Brushed");
  assert.equal(await mass(), aluminumMass, "Dye and texture preserve the physical mass");
  const blue = await fileFrom(button(page, "Save PNG"));
  assert.equal(blue.toString("ascii", 1, 4), "PNG");
  assert(!blue.equals(natural), "The actual exported scene shows the appearance change");

  await appearance.getByText("Custom color", {exact: true}).click();
  await field(appearance, "Hex color").fill("#123");
  assert(await button(appearance, "Apply color").isDisabled());
  await field(appearance, "Hex color").fill("#389FAE");
  await button(appearance, "Apply color").click();
  await button(page, "Undo").click();
  await selected("Blue anodizing");
  await button(page, "Redo").click();
  await active.selectOption("cap");
  await selected("Brass for End button");
  await selected("Polished");
  assert.equal(await button(appearance, "Blue anodizing").count(), 0);
  await button(appearance, "Titanium for End button").click();
  await button(appearance, "Lathe-turned").click();
  await selected("Lathe-turned");

  const doc = await native();
  assert.deepEqual(doc.workspaces.bodySurfaces, { tube: { finish: "brushed", anodize: "#389fae" }, cap: { finish: "turned" } });
  assert.deepEqual(doc.workspaces.bodyMaterials, { tube: "Aluminum", cap: "Titanium" });
  await saved(page);
  await page.reload();
  await ready(page);
  if (!await bench.isVisible()) await button(page, "Pen Studio").click();
  await active.selectOption("tube");
  await selected("Brushed");
  await appearance.getByText("#389FAE", {exact: true}).waitFor();
  await active.selectOption("cap");
  await selected("Lathe-turned");

  await button(page, "Export").click();
  await page.getByRole("button", {name: /CNC shop package/}).click();
  const dialog = page.getByRole("dialog", { name: "CNC shop package" });
  const archive = unzipSync(await fileFrom(dialog.getByRole("button", {name: /Download ZIP \(2\)/})));
  const manifest = strFromU8(archive["Shop manifest.txt"]);
  assert.match(manifest, /Custom tube \| Qty 1 \| Aluminum[^\n]*\n  Surface appearance reference · Brushed · Custom anodizing \(sRGB #389FAE\)/);
  assert.match(manifest, /End button \| Qty 1 \| Titanium[^\n]*\n  Surface appearance reference · Lathe-turned/);
  await page.locator(".project-trigger").click();
  await page.getByRole("button", {name: /Import CAD file/}).click();
  const insert = page.getByRole("dialog", {name: "Import geometry"});
  await field(insert, "Choose file to import").setInputFiles({
    name: "finished-parts.turnmil", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
  });
  await button(insert, "Insert parts").click();
  await insert.waitFor({state: "hidden", timeout: 90000});
  await ready(page);
  const copy = await native();
  const added = copy.features.filter(f => f.kind === "import");
  assert.equal(added.length, 2);
  for (const part of added) {
    const source = doc.features.find(original => original.name === part.name);
    assert(source && source.id !== part.id, "Imported components receive a new identity");
    assert.deepEqual(copy.workspaces.bodySurfaces[part.id], doc.workspaces.bodySurfaces[source.id]);
    assert.equal(copy.workspaces.bodyMaterials[part.id], doc.workspaces.bodyMaterials[source.id]);
  }
  assert.deepEqual(errors, []);
  console.log("PASS part-scoped appearance, physical mass, anodized PNG, custom color validation, Undo/Redo, native save, reload, native part insertion and per-part CNC finish manifest");
} finally {
  await browser.close();
}
