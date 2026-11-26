// Exercise the same menus, pointer gestures, and downloadable solids available in a release build.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openBrowser, appUrl } from "./browser.mjs";
import { button, download, ready, saved } from "../projects/support.mjs";

const output = resolve(process.env.QA_PART_WORKSPACES_OUT || "test-evidence/part-workspaces");
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile("test-evidence/ASM-001/two-blocks.turnmill", "utf8"));
fixture.sketches.push({ ...fixture.sketches[0], id: "upper-profile", name: "Upper profile" });
fixture.features[1].sketchId = "upper-profile";
fixture.features[1].amount = "3 mm";

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const item = (name) => page.getByRole("menuitem", { name, exact: true });
  const menu = (name) => page.getByRole("menu", { name: name + " actions", exact: true });
  const field = (name) => page.getByLabel(name, { exact: true });
  const dialog = (name) => page.getByRole("dialog", { name, exact: true });
  const row = (name) => page.locator(".tree-item").filter({ has: page.getByText(name, { exact: true }) });
  async function step(filename) {
    await button(page, "Export").click();
    await download(page, () => page.getByRole("button", { name: /STEP solid/ }).click(), join(output, filename + ".step"));
  }
  async function edit(key, value) {
    await field(key).fill(value);
    await field(key).press("Enter");
  }
  async function pointerOverBody(canvas, expected) {
    const bounds = await canvas.boundingBox();
    assert(bounds, "A visible model canvas is required");
    const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0.05, 0.95];
    for (const fy of fractions) for (const fx of fractions) {
      const x = bounds.x + bounds.width * fx, y = bounds.y + bounds.height * fy;
      await page.mouse.move(x, y);
      if (!(await canvas.evaluate((el) => el.style.cursor === "pointer"))) continue;
      await page.mouse.click(x, y, { button: "right" });
      if (await menu(expected).isVisible()) return { x, y };
      await page.keyboard.press("Escape");
    }
    throw Error("Could not pick the displayed solid for " + expected);
  }

  await page.goto(appUrl);
  await saved(page);
  await field("Open Turnmill project file").setInputFiles({
    name: "workspaces.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await tab("Upper block").waitFor();
  await ready(page);
  await row("Upper profile").click();
  const lowerProfile = row("Analytic block profile");
  await lowerProfile.focus();
  await lowerProfile.press("Shift+F10");
  await menu("Analytic block profile").waitFor();
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Delete");
  await page.keyboard.press("Escape");
  assert(await lowerProfile.evaluate((el) => el === document.activeElement), "Escape returns focus to the invoking row");
  for (const kind of ["Revolve", "Extrude"]) {
    await lowerProfile.click({ button: "right" });
    if (kind === "Extrude") await page.keyboard.press("x");
    else await item(kind).click();
    const d = dialog("Create feature");
    assert.equal(await d.getByLabel("Sketch profile").inputValue(), "b-profile");
    assert.equal(await d.locator(".choice-row .selected").innerText(), kind);
    await button(d, "Cancel").click();
    await row("Upper profile").click();
  }
  await lowerProfile.click({ button: "right" });
  await item("Delete").click();
  await page.getByText("This sketch is used by a feature. Remove that feature first.", { exact: true }).waitFor();

  await tab("Upper block").click();
  assert.equal(await row("Lower block").count(), 0);
  assert.equal(await row("Upper profile").count(), 1);
  const canvas = page.locator(".solid-viewport canvas:visible");
  const point = await pointerOverBody(canvas, "Upper block");
  await item("Revolve").click();
  assert.equal(await dialog("Create feature").getByLabel("Sketch profile").inputValue(), "upper-profile");
  await button(dialog("Create feature"), "Cancel").click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(point.x + 35, point.y + 15, { steps: 8 });
  await page.mouse.up({ button: "right" });
  assert.equal(await page.getByRole("menu").count(), 0, "Panning must not open the context menu");
  await step("upper-local");
  await tab("Lower block").click();
  await step("lower-local");

  await button(page, "New part").click();
  await field("Part name").fill("Spare insert");
  await button(page, "Create part").click();
  assert.equal(await tab("Spare insert").getAttribute("aria-selected"), "true");
  assert.equal(await page.locator(".history-list .tree-item").count(), 0);
  const blankBounds = await canvas.boundingBox();
  await canvas.click({ button: "right", position: { x: blankBounds.width * 0.16, y: blankBounds.height * 0.30 } });
  await item("New sketch").click();
  const editor = dialog("Sketch editor");
  await button(editor, "Draw a replacement rectangle").click();
  for (const [x, y] of [["0", "2"], ["8", "4"]]) {
    await editor.getByLabel("Place vertex X").fill(x);
    await editor.getByLabel("Place vertex Y").fill(y);
    await button(editor, "Place point").click();
  }
  await editor.getByLabel("Sketch canvas").click({ button: "right" });
  await item("Revolve").click();
  const create = dialog("Create feature");
  assert.equal(await create.getByLabel("Feature name").inputValue(), "Spare insert");
  assert.notEqual(await create.getByLabel("Sketch profile").inputValue(), "create");
  await button(create, "Create feature").click();
  await ready(page);
  await row("Spare insert").waitFor();
  await tab("Spare insert").click({ button: "right" });
  const menuBox = await menu("Spare insert").boundingBox();
  const viewport = page.viewportSize();
  assert(menuBox && menuBox.y + menuBox.height <= viewport.height && menuBox.x + menuBox.width <= viewport.width, "Tab menu stays within the available screen");
  await item("Rename part").click();
  await field("Part name").fill("Spare sleeve");
  await button(page, "Save name").click();
  await tab("Spare sleeve").click({ button: "right" });
  await item("Delete part").click();
  await tab("Spare sleeve").waitFor({ state: "detached" });
  await button(page, "Undo").click();
  await tab("Spare sleeve").waitFor();
  await button(page, "Redo").click();
  await tab("Spare sleeve").waitFor({ state: "detached" });
  console.log("PASS targeted sketch/solid commands, keyboard focus, pan, tab isolation, rename, undo and redo");

  await tab("Assembly").click();
  const component = field("Component"), joint = field("Joint");
  await component.selectOption("b");
  assert.equal(await joint.inputValue(), "free");
  await component.selectOption("upper");
  assert.equal(await joint.inputValue(), "fixed");
  await page.locator(".joint-stage .joint-message").waitFor({ state: "hidden" });
  await component.click({ button: "right" });
  await item("Float at current position").click();
  assert.equal(await joint.inputValue(), "free");
  await component.click({ button: "right" });
  await item("Position…").click();
  assert.equal(parseFloat(await field("Position Z").inputValue()), 20);
  for (const [key, val] of [["Position X", "32 mm"], ["Position Y", "-6 mm"], ["Position Z", "12 mm"]]) await edit(key, val);
  await step("translated");
  await edit("Rotation Z", "90 deg");
  await step("rotated");
  await button(page, "Fit assembly").click();
  const p = await pointerOverBody(page.locator(".joint-stage canvas"), "Upper block");
  await page.keyboard.press("Escape");
  const readPosition = () => Promise.all(["Position X", "Position Y", "Position Z"].map(async (name) => parseFloat(await field(name).inputValue())));
  const beforeDrag = await readPosition();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 35, p.y + 19, { steps: 8 });
  await page.mouse.up();
  const afterDrag = await readPosition();
  assert(Math.hypot(...afterDrag.map((v, i) => v - beforeDrag[i])) > 0.1, "Pointer drag moves an unconstrained part");
  await button(page, "Undo").click();
  assert.deepEqual(await readPosition(), beforeDrag, "A complete drag undoes in one edit");
  await component.click({ button: "right" });
  await item("Fix at current position").click();
  assert.equal(await joint.inputValue(), "fixed");
  await step("fixed");
  await saved(page);
  await page.reload();
  await saved(page);
  await tab("Assembly").click();
  await component.selectOption("upper");
  assert.equal(await joint.inputValue(), "fixed");
  await page.locator(".joint-stage .joint-message").waitFor({ state: "hidden" });
  await step("reopened");
  await component.click({ button: "right" });
  await item("Open part tab").click();
  assert.equal(await tab("Upper block").getAttribute("aria-selected"), "true");
  assert.equal(await row("Lower block").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS float a fixed child, precise translation/rotation, free drag, one-step undo, ground, reopen and STEP exports");
} finally {
  await browser.close();
}
