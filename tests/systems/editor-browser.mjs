import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { openBrowser, appUrl, measure } from "../qa/browser.mjs";
import {
  feature,
  boxSketch,
  project,
  save,
  near,
  evidence,
} from "./runtime.mjs";
const browser = await openBrowser(),
  rows = [],
  errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1260, height: 855 },
    deviceScaleFactor: 2,
  });
  page.setDefaultTimeout(40000);
  page.on("pageerror", (e) => errors.push(e.message));
  const b = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(appUrl);
  await measure(page);
  async function openFixture(name, p) {
    p.name = name;
    p.id = name;
    await save("viewport/" + name + ".turnmill", p);
    await page
      .getByLabel("Open Turnmill project file")
      .setInputFiles(resolve(evidence, "viewport/" + name + ".turnmill"));
    await page.waitForFunction(
      (name) =>
        document.querySelector(".project-trigger")?.innerText.includes(name),
      name,
    );
    const s = await measure(page);
    assert.equal(s.project.name, name);
    return s;
  }
  const viewport = page.locator(".solid-viewport canvas").first();
  for (const [name, w, h, z] of [
    ["small", 0.1, 0.2, 0.3],
    ["large", 50000, 25000, 800],
    ["normal", 10, 5, 2],
  ]) {
    const snap = await openFixture(
      name,
      project(
        [boxSketch("profile", 0, 0, w, h)],
        [feature("block", "profile", z)],
      ),
    );
    assert.equal(snap.bodies[0].valid, true);
    near(snap.volume, w * h * z, Math.abs(w * h * z) * 0.001, name + " volume");
    await page.keyboard.press("f");
    const box = await viewport.boundingBox(),
      x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.click(x, y);
    await page
      .getByText(/Body 1 · Face \d+/)
      .first()
      .waitFor();
    await page.mouse.move(2, 2);
    const shot = await viewport.screenshot({
      path: resolve(evidence, "viewport/" + name + ".png"),
    });
    const pix = await viewport.evaluate((c) => ({
      w: c.width,
      css: c.getBoundingClientRect().width,
      dpr: devicePixelRatio,
    }));
    near(pix.w, pix.css * pix.dpr, 2, "high-DPI render width");
    rows.push({
      name,
      volume: snap.volume,
      displayedFace: await page
        .getByText(/Body 1 · Face \d+/)
        .first()
        .innerText(),
      canvas: pix,
      frame: createHash("sha256").update(shot).digest("hex"),
    });
    if (name === "normal") {
      const frames = [];
      for (const action of ["orbit", "pan", "zoom"]) {
        await page.mouse.move(x, y);
        if (action === "zoom") await page.mouse.wheel(0, -260);
        else {
          if (action === "pan") await page.keyboard.down("Shift");
          await page.mouse.down();
          await page.mouse.move(x + 70, y + 35, { steps: 8 });
          await page.mouse.up();
          if (action === "pan") await page.keyboard.up("Shift");
        }
        await page.mouse.move(2, 2);
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        const hash = createHash("sha256")
          .update(await viewport.screenshot())
          .digest("hex");
        assert.notEqual(
          hash,
          frames.at(-1)?.hash || rows.at(-1).frame,
          "Expected " + " " + action + " to move view",
        );
        frames.push({ action, hash });
      }
      rows.push({ cameraActions: frames });
      await b("Edit sketch").click();
    }
  }
  await b("Draw a replacement rectangle").click();
  async function place(x, y) {
    await page.getByLabel("Place vertex X").fill(String(x));
    await page.getByLabel("Place vertex Y").fill(String(y));
    await b("Place point").click();
  }
  await place(0, 0);
  await place(12, 5);
  const nodes = page.locator(".sk-node");
  assert.equal(await nodes.count(), 4);
  const before = await nodes.locator("title").allTextContents();
  await page
    .locator(".sk-feedback")
    .filter({ hasText: "4 degrees of freedom" })
    .waitFor();
  const target = nodes.nth(2).locator("circle").last();
  await target.hover();
  const handle = await target.boundingBox();
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 - 42,
    handle.y + handle.height / 2 - 23,
    { steps: 8 },
  );
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.mouse.up();
  await page.waitForFunction(
    (before) =>
      JSON.stringify(
        [...document.querySelectorAll(".sk-node title")].map(
          (x) => x.textContent,
        ),
      ) !== JSON.stringify(before),
    before,
  );
  function coords(labels) {
    return labels.map((s) =>
      s
        .match(/· ([\d.−-]+), ([\d.−-]+) mm/)
        .slice(1)
        .map(Number),
    );
  }
  const after = await nodes.locator("title").allTextContents();
  const pts = coords(after);
  for (const [a, c, d] of [
    [0, 1, 1],
    [1, 2, 0],
    [2, 3, 1],
    [3, 0, 0],
  ])
    near(
      pts[a][d],
      pts[c][d],
      0.01,
      "adjacent endpoints stayed horizontal/vertical",
    );
  await b("Undo sketch edit").click();
  assert.deepEqual(await nodes.locator("title").allTextContents(), before);
  await b("Redo sketch edit").click();
  assert.deepEqual(await nodes.locator("title").allTextContents(), after);
  await page.screenshot({
    path: resolve(evidence, "viewport/constrained-drag.png"),
  });
  await b("Pan sketch").click();
  const a = await nodes.first().locator("circle").first().boundingBox();
  const canvas = await page.locator(".sk-canvas").boundingBox();
  const sx = canvas.x + canvas.width * 0.4,
    sy = canvas.y + canvas.height * 0.4;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 65, sy + 35, { steps: 8 });
  await page.mouse.up();
  const afterPan = await nodes.first().locator("circle").first().boundingBox();
  assert(Math.abs(a.x - afterPan.x) > 5);
  assert.deepEqual(await nodes.locator("title").allTextContents(), after);
  await b("Draw a replacement polygon").click();
  await place(0, 0);
  await place(6, 0);
  await place(0, 4);
  await b("Close profile").click();
  await b("Finish sketch").click();
  await page.waitForFunction(() => !document.querySelector(".sk-canvas"));
  const triangle = await measure(page);
  near(triangle.volume, 24, 0.024, "triangle by numeric polygon tool");
  rows.push({ sketch: { before, after, triangleVolume: triangle.volume } });
  assert.deepEqual(errors, []);
  console.log(
    "PASS tiny/large solids, DPR 2, selection, orbit/pan/zoom, sketch tools, constrained drag, sketch undo/redo",
  );
} finally {
  await save("viewport/results.json", { rows, errors });
  await browser.close();
}
