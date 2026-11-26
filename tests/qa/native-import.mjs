import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appUrl, measure, openBrowser } from "./browser.mjs";
import { button, ready } from "../projects/support.mjs";

const source = JSON.parse(await readFile("test-evidence/ASM-001/two-blocks.turnmill", "utf8"));
source.name = "Parametric insert";
source.parameters = [{ name: "depth", label: "Stock depth", expression: "5 mm", kind: "length" }];
source.features[0].amount = "depth";
source.features[1].amount = "depth * 2";
const placed = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,20,1];
source.workspaces.assemblyItems = {b:3, upper:7};
source.workspaces.allPartsPose = {upper: placed};
source.workspaces.bodyMaterials = {upper:"Brass"};
source.workspaces.bodyDensities = {upper:8.4};
source.emptyParts = [{ id: "spare", name: "Clip blank" }];
const native = JSON.stringify(source);
const file = (name, contents) => ({name, mimeType:"application/octet-stream", buffer: Buffer.from(contents)});
const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: {width: 1360, height: 900}, acceptDownloads: true });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const dialog = page.getByRole("dialog", {name:"Import geometry"});
  const picker = dialog.locator('input[type="file"]');
  async function openImport() {
    await page.locator(".project-trigger").click();
    await page.getByRole("button", {name:/Import CAD file/}).click();
    await dialog.waitFor();
  }
  async function dropFile(name, body) {
    const data = await page.evaluateHandle(({name, body}) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([body], name, {type:"application/octet-stream"}));
      return transfer;
    }, {name, body});
    try { await dialog.locator(".exchange-file").dispatchEvent("drop", {dataTransfer:data}); }
    finally { await data.dispose(); }
  }
  async function result(action) {
    await button(dialog, action).click();
    await dialog.waitFor({state:"hidden"});
    await ready(page);
    return measure(page);
  }
  const volumes = s => s.bodies.map(b => Math.round(b.volume * 1e6) / 1e6);
  await page.goto(appUrl);
  await ready(page);
  const host = await measure(page);

  await openImport();
  const accept = (await picker.getAttribute("accept")).toLowerCase().split(",");
  assert(accept.includes(".turnmill") && accept.includes(".turnmil"));
  await picker.setInputFiles(file("broken.turnmill", '{"version":1}'));
  // Invalid input may be rejected while choosing or when opening.
  const open = button(dialog, "Open project");
  if (await open.isEnabled({timeout:1000}).catch(() => false)) await open.click();
  await dialog.getByRole("alert").waitFor();
  assert.deepEqual((await measure(page)).project, host.project);
  const brokenBuild = structuredClone(source);
  brokenBuild.features[1].amount = "missing_depth";
  await picker.setInputFiles(file("unresolved.turnmill", JSON.stringify(brokenBuild)));
  await button(dialog, "Insert parts").click();
  await dialog.getByRole("alert").waitFor();
  assert.deepEqual((await measure(page)).project, host.project, "A failed source rebuild leaves the destination intact");

  await picker.setInputFiles(file("parts.turnmill", native));
  const added = await result("Insert parts");
  assert.equal(added.project.id, host.project.id);
  assert.deepEqual(added.project.parameters, host.project.parameters);
  assert.deepEqual(added.project.sketches, host.project.sketches);
  assert.deepEqual(added.project.features.slice(0, host.project.features.length), host.project.features);
  const additions = added.project.features.slice(host.project.features.length);
  assert.deepEqual(additions.map(f => f.kind), ["import","import"]);
  assert.equal(new Set(additions.map(f => f.id)).size, 2);
  assert.deepEqual(added.project.workspaces.allPartsPose[additions[1].id], placed);
  assert.equal(added.project.workspaces.bodyMaterials[additions[1].id], "Brass");
  assert.equal(added.project.workspaces.bodyDensities[additions[1].id], 8.4);
  assert.equal(added.bodies.length, host.bodies.length + 2);
  assert.deepEqual(volumes(added).slice(-2), [1000, 2000]);
  for (const solid of added.bodies.slice(-2)) assert(solid.valid && solid.solids === 1);

  await page.locator(".project-trigger").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name:/Save project file/}).click();
  const savedFile = await download;
  assert(savedFile.suggestedFilename().endsWith(".turnmill"));
  const saved = await readFile(await savedFile.path(), "utf8");

  // The older spelling works through the visible drop zone with no loss of history.
  await openImport();
  await dropFile("pen.TURNMIL", native);
  const opened = await result("Open project");
  assert.deepEqual(opened.project, source);
  assert.deepEqual(volumes(opened), [1000, 2000]);
  assert.equal(opened.values.depth, 5);

  await openImport();
  await picker.setInputFiles(file("saved.turnmill", saved));
  const restored = await result("Open project");
  assert.deepEqual(restored.project, added.project);
  assert.deepEqual(volumes(restored), volumes(added));

  await openImport();
  await picker.setInputFiles(file("mark.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="8mm" height="4mm" viewBox="0 0 8 4"><rect x="1" y="1" width="5" height="2"/></svg>'));
  const geometry = await result("Import sketches");
  assert.equal(geometry.project.id, host.project.id);
  assert.equal(geometry.project.sketches.length, added.project.sketches.length + 1);
  assert.deepEqual(geometry.project.features, added.project.features);
  assert.deepEqual(errors, []);
  console.log("PASS native import picker and drop, document fidelity, two exact solids, saved insert round trip, invalid project recovery and SVG import");
} finally { await browser.close(); }
