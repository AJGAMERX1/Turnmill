// Screen capture is evidence collection. Only the image acquisition itself can be retried.
import { rm, writeFile } from "node:fs/promises";
import utils from "playwright-core/lib/utilsBundle";
import { hasX11Viewport, readX11Viewport } from "./x11-viewport.mjs";

async function compositorFrame(page) {
  const session = await page.context().newCDPSession(page);
  let timer;
  try {
    const frame = new Promise((resolve) => session.once("Page.screencastFrame", resolve));
    const receive = async () => {
      await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
      return Buffer.from((await frame).data, "base64");
    };
    return await Promise.race([
      receive(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("No viewport frame from Chromium within 30 s")), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // Detaching this dedicated observer also stops its screencast.
    await session.detach().catch(() => {});
  }
}

function checkImage(bytes, size) {
  const image = utils.PNG.sync.read(bytes);
  const { data, width, height } = image;
  if (width !== size.width || height !== size.height)
    throw Error(`Captured viewport is ${width} × ${height}; expected ${size.width} × ${size.height}`);
  const colors = new Set();
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 80))) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 80))) {
      const i = 4 * (y * width + x);
      if (data[i + 3]) colors.add(data.readUInt32BE(i));
      if (colors.size >= 8) return image;
    }
  }
  throw Error("The captured viewport is empty or uniform");
}

export async function readViewport(page, label = "viewport") {
  await page.bringToFront();
  // Poll font readiness independently of animation frames. An occluded software
  // surface can suspend requestAnimationFrame while the document remains usable.
  await page.waitForFunction(() => document.fonts.status === "loaded", undefined, {
    polling: 100, timeout: 15000,
  });
  const size = await page.evaluate(() => ({
    width: Math.round(innerWidth * devicePixelRatio),
    height: Math.round(innerHeight * devicePixelRatio),
  }));
  const failures = [];
  // A software-rendered Chromium surface can stall on Page.captureScreenshot even
  // after fonts and layout have settled. A screencast samples the displayed frame
  // through a separate DevTools command without navigating or replaying UI actions.
  for (const acquire of [
    ...(hasX11Viewport(page) ? [() => readX11Viewport(page)] : []),
    () => compositorFrame(page),
    () => page.screenshot({ animations: "disabled", type: "png", timeout: 45000 }),
  ]) {
    let bytes, image;
    try {
      bytes = await acquire();
      image = checkImage(bytes, size);
    } catch (error) {
      failures.push(error);
      if (page.isClosed()) break;
      continue;
    }
    if (failures.length) console.warn("Recovered viewport capture:", label, failures[0].message);
    return { bytes, image };
  }
  throw Error(`Could not capture ${label}: ${failures.map((e) => e.message).join(" / ")}`, {
    cause: failures.at(-1),
  });
}

export async function captureViewport(page, path) {
  await rm(path, { force: true });
  const { bytes } = await readViewport(page, path);
  await writeFile(path, bytes);
}
