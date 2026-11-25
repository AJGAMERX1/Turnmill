import { readViewport } from "../qa/capture.mjs";
import { chromium } from "playwright-core";
import { unzipSync, strFromU8 } from "fflate";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const out = process.env.TURNMILL_SHORTCUT_EVIDENCE || "test-evidence/browser";
const url = process.env.TURNMILL_URL || "http://127.0.0.1:4197/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 930 },
  acceptDownloads: true,
});
page.setDefaultTimeout(15000);
const results = [],
  pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const dialog = (name) => page.getByRole("dialog", { name, exact: true });
const button = (root, name) => root.getByRole("button", { name, exact: true });
const press = (key) => page.keyboard.press(key);
const featureButtons = page.locator(
  'button[title="Select feature · double-click to edit"]',
);
const title = page.locator(".project-trigger span");
const state = (selector, value) =>
  page.waitForFunction(
    ([sel, val]) => document.querySelector(sel)?.textContent.trim() === val,
    [selector, value],
  );
const named = (name) => state(".project-trigger span", name);
const ready = () => state(".status-bar > span:first-child", "Ready");
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const record = (key, detail) => {
  results.push({ key, detail });
  console.log(key, detail);
};
async function open(key, name) {
  await press(key);
  const d = dialog(name);
  await d.waitFor();
  return d;
}
async function close(d) {
  await press("Escape");
  await d.waitFor({ state: "hidden" });
}
async function rename(name) {
  const d = await open("Alt+r", "Rename project");
  await d.getByLabel("Project name").fill(name);
  await button(d, "Save name").click();
  await named(name);
}
async function download(key) {
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    press(key),
  ]);
  return {
    filename: file.suggestedFilename(),
    data: await readFile(await file.path()),
  };
}
async function canvasHash() {
  const canvas = page.locator(".solid-viewport canvas");
  const geometry = async () => canvas.evaluate((c) => {
    const { x, y, width, height } = c.getBoundingClientRect();
    return { x, y, width, height, dpr: devicePixelRatio };
  });
  const box = await geometry();
  const { image } = await readViewport(page, "model viewport");
  assert.deepEqual(await geometry(), box, "Canvas shifted during capture");
  // Use pixels from the center of the solid canvas, away from menu and view
  // labels. A text-only change cannot satisfy the orientation or fit checks.
  const left = Math.round((box.x + box.width * 0.15) * box.dpr);
  const right = Math.round((box.x + box.width * 0.85) * box.dpr);
  const top = Math.round((box.y + box.height * 0.2) * box.dpr);
  const bottom = Math.round((box.y + box.height * 0.8) * box.dpr);
  assert(left >= 0 && top >= 0 && right <= image.width && bottom <= image.height);
  assert(right > left && bottom > top, "The model canvas must be visible");
  const hash = createHash("sha256");
  for (let y = top; y < bottom; y++)
    hash.update(image.data.subarray(4 * (image.width*y + left), 4 * (image.width*y + right)));
  return hash.digest("hex");
}
try {
  await page.goto(url);
  await ready();
  const start = await open("Alt+n", "New project");
  await start.getByRole("button", { name: /Turned part/ }).click();
  await ready();
  assert.equal(await featureButtons.count(), 1);
  const baseName = await title.innerText();
  record("Alt+N", "Created disposable turned-part template: " + baseName);
  await page.locator(".project-trigger").click();
  const fileMenu = page.locator(".file-menu-holder .dropdown");
  await fileMenu.waitFor();
  await press("Escape");
  await fileMenu.waitFor({ state: "hidden" });
  record("Escape", "Dismissed open project menu");
  const barrel = await featureButtons.locator("span").innerText();
  await featureButtons.click();

  for (const [key, name] of [
    ["Alt+h", "Hardware library"],
    ["Alt+i", "Import geometry"],
    ["a", "Advanced operation"],
    ["g", "Finish " + barrel],
    ["p", "Named parameters"],
    ["Shift+Slash", "Pen walkthrough"],
  ]) {
    const d = await open(key, name);
    record(key, "Opened " + name);
    await close(d);
  }
  for (const [key, prefix] of [
    ["Control+k", ""],
    ["Meta+k", ""],
    ["Shift+Semicolon", ":"],
  ]) {
    const d = await open(key, "Command palette");
    assert.equal(await d.getByRole("combobox").inputValue(), prefix);
    record(
      key,
      prefix
        ? "Opened command lookup with colon prefix"
        : "Opened command palette",
    );
    await close(d);
  }
  for (const [key, expectedHeading] of [
    ["s", "Sketch 2"],
    ["e", await page.locator(".sketch-node span").first().innerText()],
  ]) {
    if (key === "e") await page.locator(".sketch-node").first().click();
    const d = await open(key, "Sketch editor");
    await d
      .getByRole("heading", { name: expectedHeading, exact: true })
      .waitFor();
    record(key, "Opened sketch editor for " + expectedHeading);
    await button(d, "Cancel sketch edits").click();
    await d.waitFor({ state: "hidden" });
  }
  await featureButtons.first().click();
  const edit = await open("Alt+e", "Edit feature");
  assert.equal(await edit.getByLabel("Feature name").inputValue(), barrel);
  record("Alt+E", "Opened existing feature " + barrel);
  await close(edit);
  const r = await open("r", "Create feature");
  assert.equal(await r.locator(".choice-row .selected").innerText(), "Revolve");
  assert.equal(await r.getByLabel("Angle about X").inputValue(), "360 deg");
  record("R", "Revolve editor opened with 360-degree angle");
  await close(r);
  const x = await open("x", "Create feature");
  assert.equal(await x.locator(".choice-row .selected").innerText(), "Extrude");
  await x.getByLabel("Feature name").fill("Shortcut extrusion");
  await button(x, "Create feature").click();
  await ready();
  const order = () => featureButtons.locator("span").allTextContents();
  assert.deepEqual(await order(), [barrel, "Shortcut extrusion"]);
  record("X", "Created independent extrusion and verified feature history");
  const ext = featureButtons.filter({ hasText: "Shortcut extrusion" });
  await ext.click();
  await press("Alt+ArrowUp");
  assert.deepEqual(await order(), ["Shortcut extrusion", barrel]);
  record("Alt+ArrowUp", "Moved selected feature to first position");
  await press("Alt+ArrowDown");
  assert.deepEqual(await order(), [barrel, "Shortcut extrusion"]);
  record("Alt+ArrowDown", "Restored second position");
  await press("h");
  await page
    .locator(".feature-group.suppressed")
    .filter({ has: ext })
    .waitFor();
  await state(".status-bar > span:nth-of-type(2)", "1 body");
  await press("h");
  await page.locator(".feature-group.suppressed").waitFor({ state: "hidden" });
  await state(".status-bar > span:nth-of-type(2)", "2 bodies");
  record(
    "H",
    "Suppressed and restored extrusion; 2 to 1 to 2 displayed bodies",
  );
  const ren = await open("F2", "Rename selected item");
  await ren.getByLabel("Item name").fill("Renamed extrusion");
  await button(ren, "Save name").click();
  assert.deepEqual(await order(), [barrel, "Renamed extrusion"]);
  record("F2", "Selected feature renamed in history");
  await press("Backspace");
  await state(".status-bar > span:nth-of-type(2)", "1 body");
  assert.deepEqual(await order(), [barrel]);
  record("Backspace", "Removed selected extrusion only");

  for (const mod of ["Control", "Meta"]) {
    const changed = "Shortcut " + mod;
    await rename(changed);
    record("Alt+R", "Project title changed to " + changed);
    await press(mod + "+z");
    await named(baseName);
    record(mod + "+Z", "Restored original project title");
    await press(mod + "+Shift+z");
    await named(changed);
    record(mod + "+Shift+Z", "Restored renamed project title");
    const file = await download(mod + "+s");
    const project = JSON.parse(file.data);
    assert.equal(project.name, changed);
    assert.equal(project.features.length, 1);
    assert.match(file.filename, /\.turnmill$/i);
    record(mod + "+S", {
      filename: file.filename,
      bytes: file.data.length,
      name: project.name,
    });
    await rename("Before reopen");
    const [choice] = await Promise.all([
      page.waitForEvent("filechooser"),
      press(mod + "+o"),
    ]);
    await choice.setFiles({
      name: file.filename,
      mimeType: "application/json",
      buffer: file.data,
    });
    await named(changed);
    assert.deepEqual(await order(), [barrel]);
    record(
      mod + "+O",
      "Reopened downloaded native file into the visible history",
    );
    await rename(baseName);
  }
  await ready();
  for (const [key, workspace] of [
    ["Alt+2", "Assembly"],
    ["Alt+3", "Drawing"],
    ["Alt+4", "Scales"],
    ["Alt+1", "Part"],
  ]) {
    await press(key);
    await page.locator(`.tm-app[data-workspace="${workspace}"]`).waitFor();
    const pane = {
      Part: ".model-space:not(.offscreen)",
      Assembly: "h2:has-text('Assemble two or more bodies')",
      Drawing: ".tm-workspace .tm-work-head:has-text('Drawing')",
      Scales: ".tm-ruler-stage",
    }[workspace];
    await page.locator(pane).first().waitFor();
    record(key, "Switched to visible " + workspace + " workspace");
  }
  const images = [];
  for (const [key, view] of [
    ["2", "Front"],
    ["3", "Top"],
    ["4", "Right"],
    ["1", "Isometric"],
  ]) {
    await press(key);
    await state("button.view-select", view);
    images.push(await canvasHash());
    record(key, "Selected " + view + " view; SHA-256 " + images.at(-1));
  }
  assert.equal(
    new Set(images).size,
    4,
    "Each orientation renders a different viewport image",
  );
  assert.equal(await canvasHash(), images.at(-1), "An unchanged model view retains its frame");
  const canvas = page.locator(".solid-viewport canvas"),
    area = await canvas.boundingBox();
  await page.mouse.move(
    area.x + area.width * 0.35,
    area.y + area.height * 0.35,
  );
  await page.mouse.wheel(0, -520);
  await page.mouse.move(2, 2);
  const zoomed = await canvasHash();
  assert.notEqual(zoomed, images.at(-1), "Wheel visibly zoomed the model");
  await press("f");
  const fitted = await canvasHash();
  assert.equal(
    fitted,
    images.at(-1),
    "Fit returns to the exact initial fitted frame",
  );
  record("F", { zoomed, fitted });
  for (const [key, extension] of [
    ["Alt+s", "step"],
    ["Alt+t", "stl"],
    ["Alt+m", "3mf"],
  ]) {
    const { data, filename } = await download(key);
    assert(filename.toLowerCase().endsWith("." + extension));
    if (extension === "step") {
      assert.match(
        data.toString("utf8"),
        /^ISO-10303-21;[\s\S]*MANIFOLD_SOLID_BREP[\s\S]*END-ISO-10303-21;/,
      );
    } else if (extension === "stl") {
      assert(data.length >= 134);
      assert.equal(84 + 50 * data.readUInt32LE(80), data.length);
    } else {
      assert.equal(data.readUInt32LE(0), 0x04034b50);
      const archive = unzipSync(data);
      assert(archive["[Content_Types].xml"]);
      const model = strFromU8(archive["3D/3dmodel.model"]);
      assert.match(model, /unit="millimeter"/);
      assert.match(model, /<triangle v1="/);
      assert.match(model, /<build><item objectid="/);
    }
    record(key, { filename, bytes: data.length, sha256: hash(data) });
  }
  assert.deepEqual(pageErrors, []);
} catch (e) {
  process.exitCode = 1;
  console.error(e);
  results.push({ failure: String(e.stack || e) });
} finally {
  await writeFile(
    join(out, "shortcuts.json"),
    JSON.stringify(
      {
        time: new Date().toISOString(),
        chromium: browser.version(),
        results,
        pageErrors,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
