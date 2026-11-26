import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appUrl, openBrowser } from "./browser.mjs";
import { button, download, newProject, ready } from "../projects/support.mjs";

const output = resolve(process.env.QA_RULER_EXPORT_OUT || "test-evidence/ruler-export");
await mkdir(output, { recursive: true });
const browser = await openBrowser();
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  async function fromMenu(item, file) {
    await button(p, "Export").click();
    await download(p, () => p.getByRole("button", { name: item }).click(), join(output, file));
  }
  await p.goto(appUrl);
  await ready(p);
  await button(p, "Scales").click();
  await button(p, "Export SVG").waitFor();
  assert(await button(p, "Export STEP").isDisabled(), "An unrelated solid must never export as the ruler");
  await fromMenu(/Ruler engraving SVG/, "draft.svg");
  assert.match(await readFile(join(output, "draft.svg"), "utf8"), /Graduation_outlines/);

  await newProject(p, /Pocket ruler/);
  await fromMenu(/Ruler engraving SVG/, "ruler.svg");
  await fromMenu(/Ruler engraving DXF/, "ruler.dxf");
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
  await p.getByLabel("Export tick centerlines").check();
  await fromMenu(/Ruler engraving SVG/, "centerlines.svg");
  await download(p, () => button(p, "Export SVG").click(), join(output, "panel.svg"));
  const centered = await readFile(join(output, "centerlines.svg"), "utf8");
  assert.equal(centered, await readFile(join(output, "panel.svg"), "utf8"));
  assert.equal((centered.match(/data-layer="Graduations"/g) || []).length, 85);
  await button(p, "Part").click();
  await button(p, "New part").click();
  await p.getByLabel("Part name").fill("Fixture block");
  await button(p, "Create part").click();
  await button(p, "Extrude").click();
  await button(p.getByRole("dialog"), "Create feature").click();
  await ready(p);
  await button(p, "Scales").click();
  await fromMenu(/Engraved ruler STEP/, "ruler.step");
  await download(p, () => button(p, "Export STEP").click(), join(output, "panel.step"));
  assert.deepEqual(errors, []);
  console.log("PASS ruler toolbar and panel downloads, 85 metric/imperial marks at 1:1, option parity and scoped engraved STEP with fixture present.");
} finally {
  await browser.close();
}
