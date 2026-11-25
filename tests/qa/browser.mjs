import { chromium } from "playwright-core";
export async function openBrowser() {
  return chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
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
