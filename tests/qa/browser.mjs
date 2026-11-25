import { chromium } from "playwright-core";
import { calibrateX11, x11Evidence } from "./x11-viewport.mjs";
export async function openBrowser({ displayEvidence = false } = {}) {
  const headed = x11Evidence && displayEvidence;
  const browser = await chromium.launch({
    headless: !headed,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROMIUM_PATH,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      ...(headed
        ? ["--ozone-platform=x11", "--force-device-scale-factor=1", "--window-position=20,20"]
        : []),
    ],
  });
  try {
    if (headed) await calibrateX11(browser);
    return browser;
  } catch (e) {
    await browser.close();
    throw e;
  }
}
export const appUrl = process.env.TURNMILL_URL || "http://127.0.0.1:4197/";
export async function measure(page) {
  return await page.evaluate(async () => {
    const end = Date.now() + 180000;
    while (Date.now() < end) {
      if (window.__cadTest) {
        try {
          const value = await window.__cadTest.snapshot();
          if (!value.busy) return value;
        } catch (e) {
          if (!/rebuild|chang|opening/i.test(String(e))) throw e;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw Error("No stable model measurement within 180 seconds");
  });
}
