import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { boxSketch, feature, project, runtime } from "../systems/runtime.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";
import { appUrl, openBrowser } from "./browser.mjs";

const api = await runtime(false);
let nose;
try {
  const { createThreadedCone } = await api.load("threadedCone");
  const body = feature("Sleeve", "section", "360 deg", "revolve");
  body.finishes = [{
    id: "flutes", name: "Front grip", kind: "grip", style: "flutes", end: "end",
    count: "4", length: "8 mm", width: "0.8 mm", depth: "0.2 mm", offset: "2 mm",
  }];
  const sleeve = project([boxSketch("section", 0, 5.5, 75, 10)], [body]);
  nose = createThreadedCone(sleeve, body.id, { axis: "X", centerline: [0, 0, 0], station: 75, outside: 20, bore: 11 }, {
    end: "end", size: "M16 × 1", length: "3 mm", coneLength: "12 mm",
    tipDiameter: "4 mm", opening: "2.4 mm", allowance: "0.1 mm", mode: "cosmetic",
  }).project;
} finally {
  await api.close();
}

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 930 } });
  page.setDefaultTimeout(30000);
  await page.goto(appUrl);
  await saved(page);
  await field(page, "Open Turnmill project file").setInputFiles({
    name: "fluted-sleeve.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(nose)),
  });
  await page.getByRole("tab", { name: "Sleeve", exact: true }).click();
  await ready(page);

  await button(page, "Threads").click();
  const dialog = page.getByRole("dialog", { name: "Threads", exact: true });
  await button(dialog, "Screw-on cap").click();
  const proposal = dialog.locator(".thread-fit-suggestion");
  await proposal.waitFor({ timeout: 120000 });
  assert.match(await proposal.innerText(), /M18 × 1\b/);
  assert.match(await proposal.innerText(), /16\.7 mm/);
  assert(await button(dialog, "Create threaded cap").isDisabled(), "narrowing an existing nose requires accepting the fit");
  await button(dialog, "Use suggested fit").click();
  assert.equal(await field(dialog, "Thread size").inputValue(), "M18 × 1");
  assert.equal(await field(dialog, "Cap outside diameter").inputValue(), "20 mm");
  assert.equal(await field(dialog, "Thread length").inputValue(), "1.75 mm");
  await field(dialog, "Thread geometry").selectOption("cosmetic");
  await button(dialog, "Create threaded cap").click();
  await Promise.race([
    dialog.waitFor({ state: "hidden", timeout: 180000 }),
    dialog.getByRole("alert").waitFor({ timeout: 180000 }).then(async () => { throw Error(await dialog.getByRole("alert").innerText()); }),
  ]);
  await ready(page);
  await page.locator(".project-trigger").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Save project file/ }).click();
  const result = JSON.parse(await readFile(await (await download).path(), "utf8"));
  const value = name => parseFloat(result.parameters.find(p => p.name === name).expression);
  assert.equal(value("cone_base"), 16.7);
  assert.equal(value("cone_opening"), 2.4);
  assert.equal(value("cap_diameter"), 20);
  assert.equal(value("cap_pitch"), 1);
  assert.deepEqual(result.sketches[0], nose.sketches[0]);
  assert.deepEqual(result.features[0].finishes.slice(-2).map(f => f.preparation), ["flush", "flush"]);
  assert.equal(Object.keys(result.workspaces.capMounts).length, 1);
  console.log("PASS fine-pitch flush cap over an M16 nose on a fluted sleeve");
} finally {
  await browser.close();
}
