import assert from "node:assert/strict";
import { boxSketch, feature, project, runtime } from "../systems/runtime.mjs";
import { field, ready, saved } from "../projects/support.mjs";
import { appUrl, openBrowser } from "./browser.mjs";

const barrel = project([boxSketch("section", 0, 5, 60, 10)], [feature("barrel", "section", "360 deg", "revolve")]);
const api = await runtime(false);
let pen;
try {
  const { createThreadedCone } = await api.load("threadedCone");
  const stock = { axis: "X", centerline: [0, 0, 0], station: 60, outside: 20, bore: 10 };
  pen = createThreadedCone(barrel, "barrel", stock, {
    end: "end", size: "M16 × 1", length: "4.5 mm", coneLength: "15 mm",
    tipDiameter: "6 mm", opening: "4 mm", allowance: "0.10 mm", mode: "modeled",
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
  const bore = field(page, "Bore diameter");
  const tip = field(page, "Tip outside diameter");

  async function selectCone() {
    await page.getByRole("tab", { name: "Screw-on cone", exact: true }).click();
    await page.locator(".tree-item").filter({ has: page.getByText("Screw-on cone", { exact: true }) }).click();
  }
  async function openPen(doc) {
    await field(page, "Open Turnmill project file").setInputFiles({
      name: "cone.turnmil", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
    });
    await selectCone();
  }
  async function enter(input, value) {
    await input.fill(value);
    await input.press("Enter");
    await page.locator(".selection-dimensions:not(:disabled)").waitFor({ timeout: 90000 });
  }

  await openPen(pen);
  await ready(page);
  assert.equal(await bore.inputValue(), "4 mm");
  await enter(bore, "2.27 mm");
  await enter(tip, "4 mm");
  await saved(page);
  await enter(tip, "2.27 mm");
  await page.getByRole("alert").filter({ hasText: /bore.*tip outside diameter/i }).waitFor();
  assert.equal(await page.locator(".stage-error").count(), 0);
  await page.reload();
  await selectCone();
  await ready(page);
  assert.equal(await bore.inputValue(), "2.27 mm");
  assert.equal(await tip.inputValue(), "4 mm");

  const broken = structuredClone(pen);
  broken.id = "old-cone-with-inverted-wall";
  broken.parameters.find(p => p.name === "cone_tip").expression = "2.27 mm";
  broken.parameters.find(p => p.name === "cone_opening").expression = "2.5 mm";
  await openPen(broken);
  await page.locator(".stage-error").filter({ hasText: /bore.*tip outside diameter/i }).waitFor();
  await enter(tip, "4 mm");
  await ready(page);
  await enter(bore, "2.27 mm");
  await ready(page);
  await saved(page);
  assert.equal(await bore.inputValue(), "2.27 mm");
  assert.equal(await tip.inputValue(), "4 mm");
  console.log("PASS cone bore and tip edits, rejected zero wall, autosave and native project recovery");
} finally {
  await browser.close();
}
