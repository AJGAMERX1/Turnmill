import { openBrowser, appUrl } from "../qa/browser.mjs";

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(30000);
  await page.goto(appUrl);
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.locator(".project-trigger").click();
  await page.getByRole("button", { name: /^New project/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Bolt-action pen/ }).click();
  const panel = page.getByRole("region", { name: "Bolt action", exact: true });
  await panel.getByRole("button", { name: "Writing" }).click();
  await panel.getByText("2.30 mm", { exact: true }).waitFor();
  if (process.env.TURNMILL_BOLT_SCREENSHOT) await page.screenshot({ path: process.env.TURNMILL_BOLT_SCREENSHOT });
  await page.getByRole("button", { name: "Part", exact: true }).first().click();
  await page.getByRole("button", { name: "Assembly", exact: true }).first().click();
  await panel.getByText("2.30 mm", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Pocket" }).click();
  await panel.getByText("0.80 mm", { exact: true }).waitFor();
  console.log("Passed bolt-action project creation, both pose controls, tip projection and saved pose on mode re-entry.");
} finally {
  await browser.close();
}
