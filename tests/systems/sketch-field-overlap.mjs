import assert from "node:assert/strict";

// Gate delivery of one genuine PlaneGCS solution in this disposable page.
// Restore Promise.then before returning control to the keyboard test.
async function holdSolution(page, expectedX) {
  await page.evaluate((x) => {
    const then = Promise.prototype.then;
    let armed = true;
    delete window.releaseSketchSolution;
    Promise.prototype.then = function (fulfilled, rejected) {
      return then.call(this, (value) => {
        if (
          armed && typeof fulfilled === "function" &&
          Math.abs(value?.vertices?.[1]?.x - x) < 1e-8 && Array.isArray(value.edgePaths)
        ) {
          armed = false;
          Promise.prototype.then = then;
          return new Promise((resolve, reject) => {
            window.releaseSketchSolution = () => {
              delete window.releaseSketchSolution;
              try {
                resolve(fulfilled(value));
              } catch (error) {
                reject(error);
              }
            };
          });
        }
        return typeof fulfilled === "function" ? fulfilled(value) : value;
      }, rejected);
    };
  }, expectedX);
}

const state = (field) => field.evaluate((e) => ({
  text: e.value,
  focused: e === document.activeElement,
  selection: [e.selectionStart, e.selectionEnd],
}));

export async function sketchFieldOverlap(page, field) {
  const observations = [];
  const settled = () => page.waitForFunction(
    () => !document.querySelector(".sk-feedback")?.textContent.includes("Solving sketch"),
  );
  for (const [previous, typed, commit] of [
    ["10.30", "10.31", true],
    ["10.40", "10 + ", false],
  ]) {
    await holdSolution(page, Number(previous));
    await field.fill(previous);
    await field.press("Enter");
    await page.waitForFunction(() => typeof window.releaseSketchSolution === "function");

    await field.focus();
    await field.press("ControlOrMeta+a");
    await field.pressSequentially(typed, { delay: 20 });
    await field.evaluate((e) => e.setSelectionRange(1, 3));
    const before = await state(field);
    assert.deepEqual(before, { text: typed, focused: true, selection: [1, 3] });
    await page.evaluate(() => window.releaseSketchSolution());
    await settled();
    const after = await state(field);
    assert.deepEqual(after, before, "A completed solve must preserve focused text and selection");

    if (commit) {
      await field.press("Enter");
      await settled();
      assert.equal(await field.inputValue(), typed);
    } else {
      await field.press("Escape");
      assert.equal(await field.inputValue(), String(Number(previous)));
      assert.ok((await state(field)).focused, "Escape keeps the field focused");
      await field.press("Tab");
      assert.equal(await field.inputValue(), String(Number(previous)));
    }
    observations.push({ previous, typed, before, after, commit });
  }
  const undo = page.getByRole("button", { name: "Undo sketch edit", exact: true });
  const redo = page.getByRole("button", { name: "Redo sketch edit", exact: true });
  // Only the three committed values belong to the journal. Idle fields follow
  // each solver result, including after a redo.
  for (const expected of [10.31, 10.3, 10]) {
    await undo.click();
    await settled();
    assert.equal(Number(await field.inputValue()), expected);
  }
  assert.equal(await undo.isEnabled(), false);
  await redo.click();
  await settled();
  assert.equal(Number(await field.inputValue()), 10.3);
  await undo.click();
  await settled();
  assert.equal(Number(await field.inputValue()), 10);

  // An edited field also commits when focus moves to another input.
  await field.fill("12.5");
  await field.press("Tab");
  await settled();
  assert.equal(Number(await field.inputValue()), 12.5);
  await undo.click();
  await settled();
  assert.equal(Number(await field.inputValue()), 10);
  assert.equal(await undo.isEnabled(), false);
  return observations;
}
