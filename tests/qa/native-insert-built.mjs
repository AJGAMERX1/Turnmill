import assert from "node:assert/strict";
import { webkit } from "playwright-core";
import { readFile } from "node:fs/promises";
import { appUrl, openBrowser } from "./browser.mjs";
import { button, ready } from "../projects/support.mjs";
import { runtime } from "../systems/runtime.mjs";
import { cappedPen } from "./fixtures/capped-pen.mjs";

const api = await runtime(false);
let browser;
try {
  const { document: source } = await cappedPen(api);
  const donor = { name: "threaded-refill.turnmil", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)) };
  browser = process.env.TURNMILL_TEST_WEBKIT === "1" ? await webkit.launch() : await openBrowser();
  const page = await browser.newPage({ acceptDownloads: true });
  // A distinct worker entry URL exposes a circular import back into an entry
  // module: the canonical URL and the tagged URL get separate module state.
  // The request, its WASM initialization, and all geometry remain real.
  await page.addInitScript(() => {
    window.Worker = class extends Worker {
      constructor(url, options) {
        url = new URL(url, document.baseURI);
        url.searchParams.set("cold", "1");
        super(url, options);
      }
    };
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  async function readProject() {
    await page.locator(".project-trigger").click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", {name:/Save project file/}).click();
    return JSON.parse(await readFile(await (await download).path(), "utf8"));
  }
  const dialog = page.getByRole("dialog", {name:"Import geometry"});
  async function importDonor(action, file) {
    await page.locator(".project-trigger").click();
    await page.getByRole("button", {name:/Import CAD file/}).click();
    await dialog.getByLabel("Choose file to import").setInputFiles(file);
    await button(dialog, action).click();
    await Promise.race([
      dialog.waitFor({state:"hidden", timeout:90000}),
      dialog.getByRole("alert").waitFor({timeout:90000}).then(async () => {
        throw Error(action + " failed: " + await dialog.getByRole("alert").innerText());
      }),
    ]);
    await ready(page);
  }
  await page.goto(appUrl);
  await ready(page);
  const host = await readProject();
  await importDonor("Insert parts", donor);
  const inserted = await readProject();
  assert.equal(inserted.id, host.id);
  const newFeatures = inserted.features.slice(host.features.length);
  assert.deepEqual(newFeatures.map(f => f.name), source.features.filter(f => f.operation === "new").map(f => f.name));
  assert(newFeatures.every(f => f.kind === "import"));
  const solids = inserted.importedFiles.at(-1).bodies;
  assert.equal(solids.length, newFeatures.length);
  for (const solid of solids) assert(solid.brep.length > 100);
  await importDonor("Open project", {...donor, name:"threaded-refill.turnmill"});
  const reopened = await readProject();
  assert.equal(reopened.id, source.id);
  assert.deepEqual(reopened.features, source.features);
  assert.deepEqual(reopened.parameters, source.parameters);
  assert.deepEqual(reopened.workspaces.refills, source.workspaces.refills);
  assert.deepEqual(reopened.workspaces.joints, source.workspaces.joints);
  await button(page.getByRole("navigation", {name:"Workspaces"}), "Pen Studio").click();
  const fit = page.getByRole("region", {name:"Writing fit"});
  await button(fit, "Check writing fit").click();
  await Promise.race([
    button(fit, "Apply writing fit").waitFor({timeout:90000}),
    fit.getByRole("alert").waitFor({timeout:90000}).then(async () => {
      throw Error("Writing fit failed: " + await fit.getByRole("alert").innerText());
    }),
  ]);
  assert.equal(await fit.locator("dt").filter({hasText:"Tip beyond cone"}).locator("..").locator("dd").innerText(), "1.5 mm");
  assert.deepEqual(errors, []);
  console.log("PASS cold native import of a barrel, threaded cone, postable cap and refill, editable Open project and the writing fit.");
} finally {
  await browser?.close();
  await api.close();
}
