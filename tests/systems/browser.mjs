import { captureViewport } from "../qa/capture.mjs";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { appUrl, measure, openBrowser } from "../qa/browser.mjs";
import { save, near, evidence } from "./runtime.mjs";
const browser = await openBrowser({ displayEvidence: true }),
  errors = [],
  warnings = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  page.setDefaultTimeout(35000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) warnings.push(m.text());
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(appUrl);
  await measure(page);
  async function load(file, count) {
    const field = page.getByLabel("Open Turnmill project file");
    await field.setInputFiles(resolve(evidence, file));
    await page.waitForFunction((n) => {
      const t = document.querySelector(".status-bar")?.innerText;
      return (
        t?.includes("Ready") && t.includes(n === 1 ? "1 body" : n + " bodies")
      );
    }, count);
    const snap = await measure(page);
    assert.equal(snap.bodies.length, count);
    return snap;
  }
  await load("SYS-001/angle-limit.turnmill", 2);
  await button("Assembly").click();
  await button("3D assembly").click();
  await page.getByLabel("Component", { exact: true }).selectOption("moving");
  await page.getByLabel("Drive value", { exact: true }).fill("45 deg");
  await page.getByLabel("Drive value", { exact: true }).press("Enter");
  await page.getByLabel("Compare with").selectOption("plate");
  await button("Check pose").click();
  const report = page.locator(".joint-check");
  await page.waitForFunction(() =>
    /Expected a angle value|minimum nominal gap/i.test(
      document.querySelector(".joint-check")?.innerText || "",
    ),
  );
  await captureViewport(page, resolve(evidence, "SYS-001/clearance.png"));
  const clearance = await report.innerText();
  assert.match(clearance, /6\.00000 mm minimum nominal gap/);
  await button("Drawing").click();
  await page.getByLabel("Drawing source").selectOption("assembly");
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Expected a angle value.") ||
      document.body.innerText.includes("Exploded assembly"),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent.includes("Download PDF") && !b.disabled,
    ),
  );
  await captureViewport(page, resolve(evidence, "SYS-001/drawing.png"));
  await save("SYS-001/ui.json", {
    clearance,
    assemblyDrawingExportEnabled: await button("Download PDF").isEnabled(),
    warnings,
    errors,
  });
  await button("Part").click();
  const blank = JSON.parse(
    await readFile(
      resolve(evidence, "SYS-002/rotated-graphic.turnmill"),
      "utf8",
    ),
  );
  delete blank.features[0].finishes;
  await save("SYS-002/blank.turnmill", blank);
  await save(
    "SYS-002/rectangle.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6 2"><path fill="#000" d="M0 0H6V2H0Z"/></svg>',
  );
  const uncut = await load("SYS-002/blank.turnmill", 1);
  near(uncut.volume, 80, 0.001, "uncut plate");
  await button("Finish").click();
  await page.getByLabel("Operation", { exact: true }).selectOption("mark");
  await page.getByLabel("Artwork", { exact: true }).selectOption("graphic");
  await page
    .locator('input[accept*="image/svg+xml"]')
    .setInputFiles(resolve(evidence, "SYS-002/rectangle.svg"));
  await page.getByText(/Filled SVG · rectangle.svg/).waitFor();
  await page.getByLabel("End", { exact: true }).selectOption("start");
  for (const [label, value] of [
    ["Artwork height", "2 mm"],
    ["Cut depth", "0.2 mm"],
    ["Offset from end", "1 mm"],
    ["Angle on top face", "90 deg"],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  const endOptions = await page
    .getByLabel("End", { exact: true })
    .locator("option")
    .allTextContents();
  await save("SYS-005/options.json", {
    endOptions,
    mode: "Extruded stock, flat surface mark",
    offsetDirection: "X",
  });
  assert.deepEqual(endOptions, ["Start · minimum X", "End · maximum X"]);
  await button("Preview").click();
  const alert = page.locator(".finish-footer [role=alert]");
  await alert
    .filter({ hasText: /artwork extends outside the flat face/i })
    .waitFor();
  await button("Apply finishes").click();
  await alert
    .filter({ hasText: /artwork extends outside the flat face/i })
    .waitFor();
  assert.ok(await page.getByRole("dialog").isVisible());
  await page.getByLabel("Angle on top face", { exact: true }).fill("15 deg");
  await button("Preview").click();
  await page.locator('.finish-form[data-preview="ready"]').waitFor();
  const preview = await page.locator(".finish-preview-status").innerText();
  await captureViewport(page, resolve(evidence, "SYS-002/approved-preview.png"));
  await button("Apply finishes").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      document.querySelector(".status-bar")?.innerText.includes("Ready") &&
      !document.querySelector(".build-pill"),
  );
  const cut = await measure(page);
  assert.equal(cut.project.features[0].finishes[0].rotation, "15 deg");
  await captureViewport(page, resolve(evidence, "SYS-002/engraving.png"));
  const physical = await page.locator(".ins-section.properties").innerText();
  const volume = cut.bodies[0].volume;
  near(volume, 77.6, 0.0024, "Volume for complete supported graphic");
  await save("SYS-002/ui.json", {
    physical,
    preview,
    volume,
    removed: 80 - volume,
    valid: cut.bodies[0].valid,
    warnings,
    errors,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Confirmed clearance/assembly sheet and rotated engraving in release browser",
  );
} finally {
  await browser.close();
}
