import { captureViewport } from "../qa/capture.mjs";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openBrowser, appUrl, measure } from "../qa/browser.mjs";
import {
  evidence,
  save,
  feature,
  boxSketch,
  project,
  near,
} from "./runtime.mjs";
const browser = await openBrowser();
const edits = [];
try {
  const fixture = project(
    [boxSketch("profile", 0, 0, 10, 5)],
    [feature("block", "profile", 2)],
  );
  await save("SYS-004/sketch-undo.turnmill", fixture);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(25000);
  await page.goto(appUrl);
  await measure(page);
  await page
    .getByLabel("Open Turnmill project file")
    .setInputFiles(resolve(evidence, "SYS-004/sketch-undo.turnmill"));
  await page.getByText("block", { exact: true }).first().waitFor();
  await measure(page);
  await page.getByRole("button", { name: "Edit sketch", exact: true }).click();
  const x = page.getByLabel("P2 X", { exact: true });
  const original = await x.inputValue();
  assert.equal(Number(original), 10);
  for (let i = 1; i <= 82; i++) {
    const step = (10 + i / 100).toFixed(2);
    await x.focus();
    await x.press("ControlOrMeta+a");
    await x.pressSequentially(step, { delay: 20 });
    assert.equal(await x.inputValue(), step, "typed value");
    await x.press("Enter");
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".sk-feedback")
          ?.textContent.includes("Solving sketch"),
    );
    const actual = await x.inputValue();
    if (!Number.isFinite(Number(actual)))
      console.log(
        "field raw",
        actual,
        await page.locator(".sk-feedback").innerText(),
        await page.locator(".sk-node title").allTextContents(),
      );
    near(Number(actual), Number(step), 0.001, "confirmed coordinate edit");
    edits.push(step);
  }
  const undo = page.getByRole("button", {
    name: "Undo sketch edit",
    exact: true,
  });
  let available = 0;
  while (available < 82 && (await undo.isEnabled())) {
    await undo.click();
    available++;
  }
  const final = Number(await x.inputValue());
  await captureViewport(page, resolve(evidence, "SYS-004/undo-limit.png"));
  await save("SYS-004/history.json", {
    original,
    edits,
    available,
    coordinateAfterUndo: final,
  });
  assert.equal(available, 82, "All 82 sketch edits remain undoable");
  near(final, 10, 0.0001, "restored initial point");
  const redo = page.getByRole("button", {
    name: "Redo sketch edit",
    exact: true,
  });
  for (let i = 0; i < edits.length; i++) await redo.click();
  near(Number(await x.inputValue()), 10.82, 0.0001, "restored latest point");
} finally {
  await browser.close();
}
