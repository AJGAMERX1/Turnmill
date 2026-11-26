import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "three/examples/jsm/libs/fflate.module.js";
import { measureVolume } from "replicad";
import { boxSketch, feature, project, near, runtime } from "../systems/runtime.mjs";
import { ready, saved } from "../projects/support.mjs";
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
  doc.workspaces.drawing = { sources: { ["body:" + coneId]: { number: "NOSE-002", revision: "C", tolerance: "0.02 mm", note: "Deburr the writing guide." } } };
  const { features } = await evaluateModel(doc), solids = buildBodies(features);
  const volumes = solids.map(s => measureVolume(s.shape));
  releaseBodies(solids);
  const assertPart = async (data, i) => {
    const bodies = await importSolidFile("step", new Blob([data]), "shop part");
    try {
      assert.equal(bodies.length, 1);
      near(measureVolume(bodies[0].shape), volumes[i], Math.max(1e-5, volumes[i] * 1e-6), "Reimported STEP volume");
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
  const openExport = () => page.getByRole("button", { name: "Export", exact: true }).click();
  async function download(button) {
    const event = page.waitForEvent("download");
    await button.click();
    const file = await event;
    assert.equal(await file.failure(), null);
    return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
  }
  await openExport();
  await page.getByLabel("Export geometry").selectOption({ label: "Screw-on cone" });
  const single = await download(page.getByRole("button", { name: /STEP solid/ }));
  assert.equal(single.name, "Screw-on cone.step"); await assertPart(single.bytes, 1);
  async function openShop() {
    await ready(page); await openExport();
    await page.getByRole("button", { name: /CNC shop package/ }).click();
    return page.getByRole("dialog", { name: "CNC shop package" });
  }
  const dialog = await openShop();
  assert.equal(await dialog.getByRole("checkbox", { checked: true }).count(), 2);
  const file = await download(dialog.getByRole("button", { name: /Download ZIP/ }));
  assert.equal(file.name, "Shop package QA - CNC.zip");
  const archive = unzipSync(file.bytes);
  const files = Object.keys(archive).filter(key => key.endsWith(".step"));
  assert.equal(files.length, 2); assert(files.every(f => !f.includes("/")));
  await assertPart(archive[files[0]], 0); await assertPart(archive[files[1]], 1);
  const manifest = strFromU8(archive["Shop manifest.txt"]);
  for (const note of ["millimetres", "Titanium", "M10 × 1", "modeled helical", "cosmetic", "internal", "external", "9.9 mm", "NOSE-002", "revision C", "±0.02 mm", "Deburr the writing guide."]) assert(manifest.includes(note), note);
  const again = await openShop();
  await again.getByRole("checkbox", { name: /EnerGel/ }).check();
  const withRefill = unzipSync((await download(again.getByRole("button", { name: /Download ZIP/ }))).bytes);
  const refillKey = Object.keys(withRefill).find(f => f.includes("EnerGel"));
  assert(refillKey); await assertPart(withRefill[refillKey], 2);
  assert(strFromU8(withRefill["Shop manifest.txt"]).includes("Purchased reference"));
  await ready(page); await openExport();
  await page.getByLabel("Export geometry").selectOption({ label: "Screw-on cone" });
  await page.getByRole("button", { name: /Open part drawing/ }).click();
  const pdf = await download(page.getByRole("button", { name: "Download PDF", exact: true }));
  assert.equal(pdf.name, "Screw-on-cone.pdf");
  assert(pdf.bytes.subarray(0,5).equals(Buffer.from("%PDF-")));
  assert.deepEqual(errors, []);
  console.log("PASS named single STEP, local isolated browser ZIP, separate round-tripped barrel/cone solids, materials and both thread modes, purchased refill opt-in and hardware exclusion.");
} finally { await browser?.close(); server.close(); await api.close(); }
