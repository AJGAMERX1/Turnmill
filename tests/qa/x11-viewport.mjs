import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const helper = fileURLToPath(new URL("./x11-viewport.py", import.meta.url));
const browserOffsets = new WeakMap();
const sizes = new WeakMap();
export const x11Evidence = process.env.TURNMILL_X11_EVIDENCE === "1";

async function x11(command, ...args) {
  const { stdout } = await execute(
    process.env.TURNMILL_X11_PYTHON || "python3",
    [helper, command, ...args.map(String)],
    {
      encoding: "buffer",
      timeout: 15000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return stdout;
}

async function fitNativeWindow(page, width, height) {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    // Playwright emulates the requested CSS viewport. Size the actual display
    // surface as well so the last row and column are present on X11.
    await session.send("Browser.setContentsSize", { windowId, width, height });
  } finally {
    await session.detach();
  }
}

const geometry = (page) =>
  page.evaluate(() => ({
    left: window.screenX,
    top: window.screenY,
    width: window.innerWidth,
    height: window.innerHeight,
    scale: window.devicePixelRatio,
  }));

export async function calibrateX11(browser) {
  if (!x11Evidence) return;
  const probe = await browser.newContext({
    viewport: { width: 1000, height: 640 },
  });
  try {
    const page = await probe.newPage();
    const { width, height } = page.viewportSize();
    await page.bringToFront();
    await fitNativeWindow(page, width, height);
    const swatches = [
      ["left:0;top:0", "#f72977"],
      ["right:0;top:0", "#11e559"],
      ["left:0;bottom:0", "#2b5bf1"],
      ["right:0;bottom:0", "#e9c117"],
    ];
    await page.setContent(
      '<body style="margin:0;background:white">' +
        swatches
          .map(
            ([corner, color]) =>
              `<i style="position:fixed;width:12px;height:12px;${corner};background:${color}"></i>`,
          )
          .join("") +
        "</body>",
    );
    const screen = await geometry(page);
    if (screen.scale !== 1)
      throw Error("X11 QA requires one CSS pixel per display pixel");
    const anchor = JSON.parse(await x11("locate", width, height));
    browserOffsets.set(browser, {
      dx: anchor.x - screen.left,
      dy: anchor.y - screen.top,
    });
  } finally {
    // Closing the disposable context destroys the calibration page before the
    // first real document opens, including its storage and visible swatches.
    await probe.close();
  }
}

export function hasX11Viewport(page) {
  return browserOffsets.has(page.context().browser());
}

export async function readX11Viewport(page) {
  const offset = browserOffsets.get(page.context().browser());
  if (!offset) throw Error("This browser has no calibrated X11 viewport");
  let view = await geometry(page);
  if (view.scale !== 1)
    throw Error(
      "This viewport uses an emulated pixel ratio; use the Chromium frame",
    );
  const size = sizes.get(page);
  if (view.width !== size?.width || view.height !== size?.height) {
    await fitNativeWindow(page, view.width, view.height);
    view = await geometry(page);
    sizes.set(page, { width: view.width, height: view.height });
  }
  return x11(
    "capture",
    view.width,
    view.height,
    view.left + offset.dx,
    view.top + offset.dy,
  );
}
