import { captureViewport } from "../qa/capture.mjs";
import { resolve } from "node:path";
import {
  finalHistoryEdit,
  evaluateInteractiveBudget,
} from "./interactive-budget.mjs";
import { openBrowser, appUrl, measure } from "../qa/browser.mjs";
import { evidence, save, near } from "./runtime.mjs";
const browser = await openBrowser({ displayEvidence: true }),
  durations = [],
  samples = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(45000);
  await page.goto(appUrl);
  await measure(page);
  await page
    .getByLabel("Open Turnmill project file")
    .setInputFiles(resolve(evidence, "SYS-003/100-feature-history.turnmill"));
  await page
    .locator(".history-list")
    .getByText("f99", { exact: true })
    .waitFor();
  const initial = await measure(page);
  near(initial.volume, 150.5, 0.1505, "initial");
  for (const depth of [0.75, 0.5, 0.625]) {
    await page
      .locator(".history-list")
      .getByText("f99", { exact: true })
      .dblclick();
    await page.getByLabel("Depth along Z").fill(String(depth));
    const apply = page.getByRole("button", { name: "Apply changes", exact: true });
    await apply.evaluate((button) => {
      const status = document.querySelector(".status-bar > span:first-child");
      if (status?.textContent.trim() !== "Ready")
        throw Error("The model must be ready before timing an edit.");
      window.__qaApplySample = null;
      let pressTime;
      let busy = false;
      const observer = new MutationObserver(() => {
        if (pressTime === undefined) return;
        const state = status.textContent.trim();
        if (state === "Rebuilding") busy = true;
        if (busy && state === "Ready") {
          const readyTime = performance.now();
          observer.disconnect();
          window.__qaApplySample = {
            preDispatchMs: pressTime - armedTime,
            applyToReadyMs: readyTime - pressTime,
            totalMs: readyTime - armedTime,
          };
        }
      });
      observer.observe(status, { childList: true, subtree: true, characterData: true });
      function start(event) {
        if (!event.isTrusted || !event.isPrimary || event.button !== 0) return;
        pressTime = event.timeStamp;
        button.removeEventListener("pointerdown", start, true);
      }
      button.addEventListener("pointerdown", start, true);
      const armedTime = performance.now();
    });
    await apply.click();
    const sample = await page.waitForFunction(
      () => window.__qaApplySample, null, { timeout: 20000 },
    );
    const timing = await sample.jsonValue();
    await sample.dispose();
    samples.push({ depth, ...timing });
    durations.push(timing.applyToReadyMs);
    const current = await measure(page);
    near(current.volume, 149 + 1.5 * depth, 0.15, "edited geometry");
  }
  await captureViewport(page, resolve(evidence, "SYS-003/history.png"));
  const result = evaluateInteractiveBudget(finalHistoryEdit, durations);
  await save("SYS-003/result.json", {
    ...result,
    issue: "SYS-003",
    title: "Apply to Ready for a final-feature edit",
  });
  console.log(
    result.outcome,
    "SYS-003 browser Apply-to-Ready median",
    result.median.toFixed(2),
    "ms, budget",
    result.budgetMs,
    "ms.",
  );
} catch (error) {
  await save("SYS-003/result.json", {
    issue: "SYS-003",
    workload: finalHistoryEdit,
    outcome: "FAIL",
    durations,
    message: error.message,
  });
  throw error;
} finally {
  await save("SYS-003/browser-timings.json", {
    durations,
    samples,
    unit: "ms",
    start: "Trusted primary pointerdown event timestamp on Apply changes",
    end: "First Ready transition after Rebuilding",
    preDispatchMs: "Observer armed to pointerdown (driver and actionability wait)",
    totalMs: "Observer armed to Ready",
  });
  await browser.close();
}
