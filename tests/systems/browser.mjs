import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { appUrl, measure, openBrowser } from "../qa/browser.mjs";
import { save, xfail, near, evidence } from "./runtime.mjs";
const browser = await openBrowser(),
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
  await page.screenshot({ path: resolve(evidence, "SYS-001/clearance.png") });
  const clearance = await report.innerText();
  if (
    !clearance.includes("Expected a angle value.") &&
    !clearance.includes("6.00000 mm")
  )
    throw Error("Different clearance response: " + clearance);
  await xfail("SYS-001", "Browser named-angle clearance", async () =>
    assert.match(
      clearance,
      /6\.00000 mm minimum nominal gap/,
      "Expected 6 mm, displayed " + clearance.split("\n").at(-1),
    ),
  );
  await button("Drawing").click();
  await page.getByLabel("Drawing source").selectOption("assembly");
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Expected a angle value.") ||
      document.body.innerText.includes("Exploded assembly"),
  );
  await page.screenshot({ path: resolve(evidence, "SYS-001/drawing.png") });
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
  await button("Preview").click();
  await page.locator('.finish-form[data-preview="ready"]').waitFor();
  const preview = await page.locator(".finish-preview-status").innerText();
  await page.screenshot({
    path: resolve(evidence, "SYS-002/approved-preview.png"),
  });
  await button("Apply finishes").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      document.querySelector(".status-bar")?.innerText.includes("Ready") &&
      !document.querySelector(".build-pill"),
  );
  const cut = await measure(page);
  assert.equal(cut.project.features[0].finishes[0].rotation, "90 deg");
  await page.screenshot({ path: resolve(evidence, "SYS-002/engraving.png") });
  const physical = await page.locator(".ins-section.properties").innerText();
  const volume = cut.bodies[0].volume,
    delta = Math.abs(volume - 78.4);
  if (delta > 0.002 && Math.abs(volume - 77.6) > 0.002)
    throw Error("Unexpected engraving volume " + volume);
  await xfail("SYS-002", "Browser engraving volume", async () =>
    near(volume, 77.6, 0.0024, "Volume for complete graphic"),
  );
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
