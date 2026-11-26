import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appUrl, openBrowser } from "./browser.mjs";
import { button, native, saved, stepExport } from "../projects/support.mjs";
import { legacyVectors, openLegacyRuler } from "../projects/ruler.mjs";

const output = resolve(process.env.QA_RULER_EXPORT_OUT || "test-evidence/ruler-export");
await mkdir(output, { recursive: true });
const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(appUrl);
  await saved(page);
  const original = await openLegacyRuler(page, "examples/pocket-ruler.turnmill");
  assert.equal(await button(page, "Scales").count(), 0);
  await legacyVectors(original, output);
  const svg = await readFile(join(output, "ruler.svg"), "utf8");
  assert.match(svg, /width="52mm" height="18mm"/);
  assert.equal((svg.match(/data-layer="Graduation_outlines"/g) || []).length, 85);
  const dxf = await readFile(join(output, "ruler.dxf"), "utf8");
  const pairs = dxf.trim().split(/\r?\n/);
  const ticks = [];
  let entity;
  for (let i = 0; i < pairs.length; i += 2) {
    const code = Number(pairs[i]), value = pairs[i + 1];
    if (code === 0) entity = { kind: value, x: [], y: [] };
    else if (entity?.kind === "LWPOLYLINE") {
      if (code === 8 && value === "Graduation_outlines") ticks.push(entity);
      else if (code === 10) entity.x.push(Number(value));
      else if (code === 20) entity.y.push(Number(value));
      else if (code === 70) entity.closed = Number(value) === 1;
    }
  }
  assert.match(dxf, /\$INSUNITS\r?\n70\r?\n4\r?\n/);
  assert.equal(ticks.length, 85);
  assert(ticks.every((tick) => tick.closed && tick.x.length === 4));
  const centers = (upper) => ticks.filter((t) => (Math.min(...t.y) > 9) === upper)
    .map((t) => (Math.max(...t.x) + Math.min(...t.x)) / 2).sort((a, b) => a - b);
  const metric = centers(true), imperial = centers(false);
  assert.equal(metric.length, 52);
  assert.equal(imperial.length, 33);
  assert(Math.abs(metric[50] - metric[0] - 50) < 1e-8);
  assert(Math.abs(imperial[32] - imperial[0] - 50.8) < 1e-8);
  const session = { page, dir: output };
  await stepExport(session, "ruler");
  await native(session, "reopened");
  const disk = JSON.parse(await readFile(join(output, "reopened.turnmill"), "utf8"));
  assert.deepEqual(disk.workspaces.scale, original.workspaces.scale);
  await page.close();
  const reopened = await browser.newPage({ acceptDownloads: true });
  reopened.on("pageerror", error => errors.push(error.message));
  await reopened.goto(appUrl);
  await saved(reopened);
  await openLegacyRuler(reopened, join(output, "reopened.turnmill"));
  await stepExport({ page: reopened, dir: output }, "reopened");
  assert.deepEqual(errors, []);
  console.log("PASS opened v1 stock and saved its graduated B-rep as STEP before and after a native file round-trip; reference vectors preserve 85 marks.");
} finally {
  await browser.close();
}
