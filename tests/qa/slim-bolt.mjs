import assert from "node:assert/strict";
import { appUrl, openBrowser } from "./browser.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(appUrl);
  await saved(page);
  await page.locator(".project-trigger").click();
  await page.getByRole("button", { name: /^New project/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Bolt-action pen/ }).click();
  await button(page, "Pen Studio").click();
  await ready(page);
  const slim = page.getByRole("region", { name: "Slim pen", exact: true });
  await field(slim, "Diameter allowance").fill("1 mm");
  await button(slim, "Preview slimming").click();
  await Promise.race([button(slim, "Apply slimmer pen").waitFor({ timeout: 150000 }),
    slim.getByRole("alert").waitFor({ timeout: 150000 }).then(async () => { throw Error(await slim.getByRole("alert").innerText()); })]);
  const measured = await slim.getByRole("status").innerText();
  assert.match(measured, /10\.84 mm/);
  assert.match(measured, /15\.06\d* mm/);
  await button(slim, "Apply slimmer pen").click(); await ready(page);
  await saved(page); await page.reload(); await ready(page);
  await button(page, "Assembly").click();
  const poses = page.getByRole("region", { name: "Bolt action", exact: true });
  await button(poses, "Writing").click();
  await poses.getByText("2.30 mm", { exact: true }).waitFor();
  await button(poses, "Pocket").click();
  await poses.getByText("0.80 mm", { exact: true }).waitFor();
  await button(page, "Pen Studio").click();
  assert.equal(await field(page, "Grip diameter").inputValue(), "10.84 mm");
  assert.deepEqual(errors, []);
  console.log("PASS Bolt slim preview, grip Ø10.84, swept hardware Ø15.062, native reload and working/retracted positions.");
} finally { await browser.close(); }
