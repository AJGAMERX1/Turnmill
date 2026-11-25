// Compare actual X pixels with an independent screenshot of the same Chromium tab.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openBrowser } from "./browser.mjs";
import utils from "playwright-core/lib/utilsBundle";
import { readX11Viewport, x11Evidence } from "./x11-viewport.mjs";

assert(
  x11Evidence && process.env.DISPLAY,
  "Run under Xvfb with TURNMILL_X11_EVIDENCE=1",
);
const output = process.env.QA_X11_EVIDENCE_DIR || "test-evidence/runner";
const browser = await openBrowser({ displayEvidence: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 930 },
  });
  const checks = [];
  for (const [width, height] of [
    [1440, 930],
    [706, 760],
    [1150, 800],
    [1150, 800], // Repaint in place after the resize cases.
  ]) {
    if (checks.length === 3)
      await page.setViewportSize({ width: 390, height: 750 });
    await page.setViewportSize({ width, height });
    // Draw asymmetric marks, including non-repeating single-pixel edges. A
    // shifted, obscured, scaled or stale viewport cannot pass this comparison.
    await page.setContent(
      '<body style="margin:0;overflow:hidden"><canvas style="display:block"></canvas></body>',
    );
    await page.evaluate(
      ({ width, height, phase }) => {
        const c = document.querySelector("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d"),
          data = ctx.createImageData(width, height);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data.data[i] = (x + 3 * y + phase) % 251;
            data.data[i + 1] = (3 * x + 5 * y) % 239;
            data.data[i + 2] = (x * y + 37) % 199;
            data.data[i + 3] = 255;
          }
        ctx.putImageData(data, 0, 0);
      },
      { width, height, phase: checks.length },
    );
    // Read the physical display first: Chromium's own screenshot can force a
    // paint and would otherwise hide a stale-frame failure on the X11 path.
    const pixels = utils.PNG.sync.read(await readX11Viewport(page));
    const reference = utils.PNG.sync.read(
      await page.screenshot({ timeout: 15000 }),
    );
    assert.deepEqual([pixels.width, pixels.height], [width, height]);
    assert(
      reference.data.equals(pixels.data),
      `X11 viewport pixels differ from Chromium reference for ${width}×${height}`,
    );
    checks.push({
      width,
      height,
      matchingPixels: width * height,
      sha256: createHash("sha256").update(pixels.data).digest("hex"),
    });
    console.log(
      `PASS ${width}×${height}: all ${width * height} viewport pixels match`,
    );
  }
  // A machining form can have an active edit. Sampling the real top layer
  // must preserve the open dialog, focused control, value and selection.
  await page.setContent(
    '<dialog><input value="92 mm" style="caret-color:transparent"></dialog>',
  );
  await page.evaluate(() => {
    document.querySelector("dialog").showModal();
    const input = document.querySelector("input");
    input.focus();
    input.setSelectionRange(0, 2);
  });
  const state = () =>
    page.evaluate(() => {
      const input = document.querySelector("input");
      return [
        document.querySelector("dialog").matches(":modal"),
        document.activeElement === input,
        input.value,
        input.selectionStart,
        input.selectionEnd,
      ];
    });
  const before = await state();
  assert.deepEqual(before, [true, true, "92 mm", 0, 2]);
  const form = utils.PNG.sync.read(await readX11Viewport(page));
  assert.deepEqual(await state(), before);
  assert(!(await page.locator("[popover]").count()));
  const expectedForm = utils.PNG.sync.read(
    await page.screenshot({ timeout: 15000 }),
  );
  assert(
    form.data.equals(expectedForm.data),
    "Modal evidence differs from its unmodified viewport",
  );
  console.log("PASS modal, input focus, value and selection preserved");
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "x11-capture.json"),
    JSON.stringify(
      { chromium: browser.version(), checks, formState: before },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
