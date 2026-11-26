import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { unzipSync, strFromU8 } from "three/examples/jsm/libs/fflate.module.js";
import { boxSketch, feature, geometry, project, near, runtime } from "../systems/runtime.mjs";
import { button, openExport, ready, saved, singleFileDownload } from "../projects/support.mjs";
import { openBrowser } from "./browser.mjs";
import { serveBuild } from "./serve.mjs";

const api = await runtime();
const server = await serveBuild("/Turnmill/", process.env.TURNMILL_SHOP_BUILD || "dist");
let browser;
try {
  const { createThreadedCone } = await api.load("threadedCone");
  const { insertRefill } = await api.load("refills"), { insertHardware } = await api.load("hardware");
  const { buildBodies, releaseBodies } = await api.load("geometry"), { evaluateModel } = await api.load("buildModel");
  const { importSolidFile } = await api.load("exchangeSolids");
  const stock = project([boxSketch("blank", 0, 4, 102, 8)], [{ ...feature("barrel", "blank", 360, "revolve"), name: "Barrel / body" }]);
  const { project: pair, coneId } = createThreadedCone(stock, "barrel", {
    axis: "X", centerline: [0,0,0], station: 102, outside: 16, bore: 8,
  }, { end: "end", size: "M10 × 1", length: "2 mm", coneLength: "13 mm", tipDiameter: "4 mm",
    opening: "2.5 mm", allowance: "0.1 mm", mode: "cosmetic" });
  pair.features.find(f => f.id === coneId).finishes[0].mode = "modeled";
  const pilot = insertRefill(pair, "energel-lr7");
  const doc = insertHardware(pilot.project, "pin", 0, "12 mm", "cosmetic");
  doc.name = "Shop package QA"; doc.workspaces.bodyMaterials.barrel = "Titanium";
  doc.workspaces.drawing = { sources: {
    ["body:" + coneId]: { title: "Writing cone", number: "NOSE-002", revision: "C", tolerance: "0.02 mm", note: "Deburr the writing guide." },
    assembly: { title: "Pen assembly", number: "PEN-001" },
  } };
  const { features } = await evaluateModel(doc), solids = buildBodies(features);
  const specs = solids.map(({ name, shape }, i) => {
    const { bbox, volume } = geometry(shape);
    const item = i + 1, stem = String(item).padStart(2, "0") + "-" + name.replaceAll("/", "-");
    return { name, item, stem, bbox, volume };
  });
  assert.equal(specs.length, 4);
  releaseBodies(solids);
  const assertPart = async (data, i) => {
    const bodies = await importSolidFile("step", new Blob([data]), "shop part");
    try {
      assert.equal(bodies.length, 1);
      const { valid, solids, bbox, volume } = geometry(bodies[0].shape);
      assert(valid && solids === 1);
      near(volume, specs[i].volume, Math.max(1e-5, specs[i].volume * 1e-6), "Reimported STEP volume");
      bbox.forEach((corner, side) => corner.forEach((mm, axis) =>
        near(mm, specs[i].bbox[side][axis], 1e-5, "Part-local STEP bounds")));
    } finally { releaseBodies(bodies); }
  };
  browser = await openBrowser();
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 925 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(server.url); await saved(page);
  await page.getByLabel("Open Turnmill project file").setInputFiles({
    name: "shop-fixture.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
  });
  await page.locator(".project-trigger").filter({ hasText: doc.name }).waitFor();
  await ready(page);
  async function download(trigger) {
    const event = page.waitForEvent("download", { timeout: 240000 });
    const status = page.getByRole("dialog", { name: "Export", exact: true }).getByRole("alert");
    const failed = status.waitFor({ timeout: 240000 }).then(async () => { throw Error(await status.innerText()); });
    await trigger.click();
    const file = await Promise.race([event, failed]);
    assert.equal(await file.failure(), null);
    return file;
  }
  const bytes = async file => readFile(await file.path());
  const single = await singleFileDownload(page, "step", { label: "Screw-on cone" });
  assert.equal(single.suggestedFilename(), "Screw-on cone.step");
  await assertPart(await bytes(single), 1);
  const native = await singleFileDownload(page, "turnmill");
  assert.equal(native.suggestedFilename(), "Shop package QA.turnmill");
  const nativeProject = JSON.parse(await bytes(native));
  assert.deepEqual(nativeProject.features.map(f => [f.id, f.name]), doc.features.map(f => [f.id, f.name]));
  assert.equal(nativeProject.workspaces.drawing.sources.assembly.number, "PEN-001");

  await button(page, "Export").click();
  const dialog = page.getByRole("dialog", { name: "Export", exact: true });
  const check = name => dialog.getByRole("checkbox", { name, exact: true });
  for (const name of ["STEP models", "3MF print models", "Part drawings", "Assembly drawing"]) {
    assert(await check(name).isChecked(), name + " defaults on");
  }
  for (const { name, item } of specs) assert(await check(name + " · item " + item).isChecked());
  const evidence = process.env.QA_SHOP_EVIDENCE;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, "export-workspace.png") });
  }
  const zip = button(dialog, "Download ZIP");
  const file = await download(zip);
  assert.equal(file.suggestedFilename(), "Shop package QA - CNC.zip");
  if (evidence) await file.saveAs(resolve(evidence, "shop-package.zip"));
  const archive = unzipSync(await bytes(file));
  const expectedPaths = ["Shop manifest.txt", "Parts list.csv", "Drawings/Assembly.pdf"];
  for (const [i, { stem }] of specs.entries()) {
    const path = "Parts/" + stem + ".step";
    expectedPaths.push(path, "Print/" + stem + ".3mf", "Drawings/" + stem + ".pdf");
    await assertPart(archive[path], i);
  }
  assert.deepEqual(Object.keys(archive).filter(path => !path.endsWith("/")).sort(), expectedPaths.sort());
  const manifest = strFromU8(archive["Shop manifest.txt"]);
  for (const note of ["millimetres", "Titanium", "M10 × 1", "modeled helical", "cosmetic", "internal", "external", "9.9 mm", "NOSE-002", "revision C", "±0.02 mm", "Deburr the writing guide.", "Purchased reference"]) {
    assert(manifest.includes(note), note);
  }
  const localPython = resolve("../interop-tools/py/bin/python");
  const python = process.env.QA_PDF_PYTHON || process.env.QA_PYTHON || (existsSync(localPython) ? localPython : "python3");
  execFileSync(python, ["tests/qa/check-shop-archive.py", await file.path(), JSON.stringify(specs)], { stdio: "inherit" });

  await button(dialog, "Machined only").click();
  for (const { name, item } of specs) assert.equal(await check(name + " · item " + item).isChecked(), item <= 2);
  await check(specs[2].name + " · item 3").check();
  for (const name of ["3MF print models", "Part drawings", "Assembly drawing"]) await check(name).uncheck();
  const selected = unzipSync(await bytes(await download(zip)));
  assert.deepEqual(Object.keys(selected).filter(name => name.endsWith(".step")).sort(),
    specs.slice(0, 3).map(({ stem }) => "Parts/" + stem + ".step"));
  assert(!Object.keys(selected).some(path => /\.(pdf|3mf)$/.test(path)));
  assert(strFromU8(selected["Shop manifest.txt"]).includes("Purchased reference"));
  assert(!strFromU8(selected["Parts list.csv"]).includes(specs[3].name));

  await button(dialog, "Drawings").click();
  await check("Assembly drawing").check();
  await button(dialog, "All parts").click();
  const drawingsFile = await download(zip);
  assert.equal(drawingsFile.suggestedFilename(), "Shop package QA - Drawings.zip");
  const drawings = Object.keys(unzipSync(await bytes(drawingsFile)));
  assert.equal(drawings.filter(name => name.endsWith(".pdf")).length, 5);
  assert(drawings.every(name => !/\.(step|3mf)$/.test(name)));
  await button(dialog, "Clear selection").click();
  await dialog.getByLabel("Package name", { exact: true }).fill("Pen assembly review");
  const assemblyFile = await download(zip);
  assert.equal(assemblyFile.suggestedFilename(), "Pen assembly review.zip");
  const assemblyOnly = Object.keys(unzipSync(await bytes(assemblyFile))).filter(path => !path.endsWith("/"));
  assert.deepEqual(assemblyOnly.sort(), ["Drawings/Assembly.pdf", "Parts list.csv", "Shop manifest.txt"]);
  await check("Assembly drawing").uncheck();
  assert(await zip.isDisabled(), "An empty export cannot be downloaded");

  await page.keyboard.press("Escape");
  const singleDialog = await openExport(page, "Single file");
  await singleDialog.getByLabel("Export geometry").selectOption({ label: "Screw-on cone" });
  await button(singleDialog, "Open part drawing").click();
  const pdf = await download(button(page, "Download PDF"));
  assert.equal(pdf.suggestedFilename(), "Writing-cone.pdf");
  assert((await bytes(pdf)).subarray(0,5).equals(Buffer.from("%PDF-")));
  assert.deepEqual(errors, []);
  console.log("PASS complete production ZIP, individual CNC and printable solids, per-part and assembly drawings, filtered packages and single STEP/drawing.");
} finally { await browser?.close(); server.close(); await api.close(); }
