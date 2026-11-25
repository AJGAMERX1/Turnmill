import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  finalHistoryEdit,
  evaluateInteractiveBudget,
} from "./interactive-budget.mjs";
import { openBrowser, appUrl, measure } from "../qa/browser.mjs";
import { evidence, save, near } from "./runtime.mjs";
const browser = await openBrowser(),
  durations = [];
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
    await page.evaluate(() => {
      const status = document.querySelector(".status-bar");
      let busy = false;
      window.__qaReadyTime = new Promise((resolve) => {
        const start = performance.now();
        const o = new MutationObserver(() => {
          const t = status.innerText;
          if (!t.includes("Ready")) busy = true;
          if (busy && t.includes("Ready")) {
            o.disconnect();
            resolve(performance.now() - start);
          }
        });
        o.observe(status, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
    });
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    const ms = await page.evaluate(() =>
      Promise.race([
        window.__qaReadyTime,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("Ready signal missing")), 20000),
        ),
      ]),
    );
    const current = await measure(page);
    near(current.volume, 149 + 1.5 * depth, 0.15, "edited geometry");
    durations.push(ms);
  }
  await page.screenshot({ path: resolve(evidence, "SYS-003/history.png") });
  const replay = JSON.parse(
    await readFile(resolve(evidence, "SYS-003/boolean-work.json"), "utf8"),
  );
  const result = evaluateInteractiveBudget(finalHistoryEdit, durations, replay);
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
} finally {
  await save("SYS-003/browser-timings.json", {
    durations,
    unit: "ms",
    start: "Immediately before Playwright clicks Apply",
    end: "First Ready transition after rebuilding",
  });
  await browser.close();
}
