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
  ]) {
    await page.setViewportSize({ width, height });
    // Draw asymmetric marks, including non-repeating single-pixel edges. A
    // shifted, obscured, scaled or stale viewport cannot pass this comparison.
    await page.setContent(
      '<body style="margin:0;overflow:hidden"><canvas style="display:block"></canvas></body>',
    );
    await page.evaluate(
      ({ width, height }) => {
        const c = document.querySelector("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d"),
          data = ctx.createImageData(width, height);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data.data[i] = (x + 3 * y) % 251;
            data.data[i + 1] = (3 * x + 5 * y) % 239;
            data.data[i + 2] = (x * y + 37) % 199;
            data.data[i + 3] = 255;
          }
        ctx.putImageData(data, 0, 0);
      },
      { width, height },
    );
    const reference = utils.PNG.sync.read(
      await page.screenshot({ timeout: 15000 }),
    );
    let match = false,
      pixels;
    for (let attempt = 0; attempt < 6 && !match; attempt++) {
      pixels = utils.PNG.sync.read(await readX11Viewport(page));
      assert.deepEqual([pixels.width, pixels.height], [width, height]);
      match = reference.data.equals(pixels.data);
      if (!match) await new Promise((r) => setTimeout(r, 100));
    }
    assert(
      match,
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
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "x11-capture.json"),
    JSON.stringify({ chromium: browser.version(), checks }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
