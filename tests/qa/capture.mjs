// Screen capture is evidence collection. Only the image acquisition itself can be retried.
import { rm, writeFile } from "node:fs/promises";
import utils from "playwright-core/lib/utilsBundle";

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
  const { data, width, height } = utils.PNG.sync.read(bytes);
  if (width !== size.width || height !== size.height)
    throw Error(`Captured viewport is ${width} × ${height}; expected ${size.width} × ${size.height}`);
  const colors = new Set();
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 80))) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 80))) {
      const i = 4 * (y * width + x);
      if (data[i + 3]) colors.add(data.readUInt32BE(i));
      if (colors.size >= 8) return;
    }
  }
  throw Error("The captured viewport is empty or uniform");
}

export async function captureViewport(page, path) {
  await rm(path, { force: true });
  await page.bringToFront();
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return true;
  }, undefined, { timeout: 15000 });
  const size = await page.evaluate(() => ({
    width: Math.round(innerWidth * devicePixelRatio),
    height: Math.round(innerHeight * devicePixelRatio),
  }));
  const failures = [];
  // A software-rendered Chromium surface can stall on Page.captureScreenshot even
  // after fonts and layout have settled. A screencast samples the displayed frame
  // through a separate DevTools command without navigating or replaying UI actions.
  for (const acquire of [
    () => compositorFrame(page),
    () => page.screenshot({ animations: "disabled", type: "png", timeout: 45000 }),
  ]) {
    let image;
    try {
      image = await acquire();
      checkImage(image, size);
    } catch (error) {
      failures.push(error);
      if (page.isClosed()) break;
      continue;
    }
    if (failures.length) console.warn("Recovered viewport capture:", path, failures[0].message);
    await writeFile(path, image);
    return;
  }
  throw Error(`Could not capture ${path}: ${failures.map((e) => e.message).join(" / ")}`, {
    cause: failures.at(-1),
  });
}
