import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import utils from "playwright-core/lib/utilsBundle";
import { button, field, ready, singleFileDownload } from "../projects/support.mjs";
import { runtime } from "../systems/runtime.mjs";
import { appUrl, openBrowser } from "./browser.mjs";
import { cappedPen } from "./fixtures/capped-pen.mjs";

// Count disconnected metal silhouettes in the actual product PNG. Sampling every
// other pixel and ignoring tiny regions excludes anti-aliasing and single-pixel highlights.
function visibleParts(png) {
  const { data, width, height } = utils.PNG.sync.read(png);
  assert.equal(Math.max(width, height), 1920);
  const w = Math.floor(width / 2), h = Math.floor(height / 2);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      mask[y * w + x] = Number(data[4 * (2 * y * width + 2 * x)] > 92);
    }
  }
  const regions = [], stack = new Int32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    let tail = 1, size = 0;
    stack[0] = i;
    mask[i] = 0;
    while (tail) {
      const pixel = stack[--tail], x = pixel % w, y = Math.floor(pixel / w);
      size++;
      for (let row = Math.max(0, y - 1); row <= Math.min(h - 1, y + 1); row++) {
        for (let col = Math.max(0, x - 1); col <= Math.min(w - 1, x + 1); col++) {
          const next = row * w + col;
          if (mask[next]) {
            mask[next] = 0;
            stack[tail++] = next;
          }
        }
      }
    }
    if (size > 50) regions.push(size);
  }
  return regions.sort((a, b) => b - a);
}

const evidence = process.env.QA_EXPLODE_EVIDENCE;
if (evidence) await mkdir(evidence, { recursive: true });
const api = await runtime(false);
const browser = await openBrowser();
try {
  const { document } = await cappedPen(api);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(appUrl);
  await field(page, "Open Turnmill project file").setInputFiles({
    name: "capped-pen.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
  });
  await page.locator(".project-trigger").filter({ hasText: document.name }).waitFor();
  await ready(page);
  await button(page, "Pen Studio").click();
  const toggle = button(page, "Exploded view"), spacing = field(page, "Exploded view spacing");
  const bench = page.getByRole("complementary", { name: "Pen design bench" });
  const balance = bench.locator("section").filter({ has: page.getByRole("heading", { name: "Balance", exact: true }) });
  const fit = bench.getByRole("region", { name: "Diameter clearance" });
  const savePhoto = button(page, "Save PNG");
  async function png(stage, exploded) {
    const [file] = await Promise.all([page.waitForEvent("download"), savePhoto.click()]);
    assert.equal(await file.failure(), null);
    assert.equal(file.suggestedFilename(), document.name + (exploded ? " - exploded" : "") + ".png");
    const bytes = await readFile(await file.path());
    if (evidence) await writeFile(join(evidence, stage + ".png"), bytes);
    return bytes;
  }
  async function exportBytes(format) {
    const file = await singleFileDownload(page, format, format === "stl" ? "all" : undefined);
    return readFile(await file.path());
  }
  await balance.locator("dd").first().filter({ hasText: /[\d.] g$/ }).waitFor();
  const normal = await png("assembled", false);
  const normalStl = await exportBytes("stl"), savedProject = await exportBytes("turnmill");
  const balanceBefore = await balance.innerText(), fitBefore = await fit.innerText();

  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.equal(await spacing.inputValue(), "10");
  const apart = await png("exploded-10mm", true);
  const beforeRegions = visibleParts(normal), afterRegions = visibleParts(apart);
  assert(afterRegions.length > beforeRegions.length && afterRegions.length >= 3,
    "The render separates visible parts: " + beforeRegions + " → " + afterRegions);
  await spacing.focus(); await spacing.press("End");
  assert.equal(await spacing.inputValue(), "40");
  const spread = await png("exploded-40mm", true);
  assert(!spread.equals(apart), "Changing the spacing changes the actual render");
  if (evidence) await page.screenshot({ path: join(evidence, "pen-studio.png") });
  assert((await exportBytes("stl")).equals(normalStl), "Saved-pose STL geometry is invariant in exploded view");
  assert.deepEqual(JSON.parse(await exportBytes("turnmill")), JSON.parse(savedProject), "Exploding edits the view only");
  assert.equal(await balance.innerText(), balanceBefore);
  assert.equal(await fit.innerText(), fitBefore);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  const restored = await png("reassembled", false);
  assert(restored.equals(normal), "Returning to the assembly restores the original render");
  assert.deepEqual(errors, []);
  console.log("PASS separate capped pen silhouettes, adjustable exploded PNG, restored assembled image and identical fit, mass, saved project and STL.");
} finally {
  await browser.close(); await api.close();
}
