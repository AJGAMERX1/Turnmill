const assert = require("node:assert/strict");
const { join } = require("node:path");
(async () => {
  const { openBrowser } = await import("../qa/browser.mjs");
  const { captureViewport } = await import("../qa/capture.mjs");
  const browser = await openBrowser({ displayEvidence: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1450, height: 900 },
      acceptDownloads: true,
    });
    page.setDefaultTimeout(20000);
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("404"))
        console.log("Console:", m.text());
    });
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(String(e));
      console.log("ERROR", e.message);
    });
    await page.goto(process.env.TURNMILL_URL || "http://127.0.0.1:4197/");
    const palette = page.getByRole("dialog", { name: "Command palette" }),
      input = palette.getByRole("combobox", { name: "Search commands" });
    async function open(query) {
      await page.keyboard.press("Control+k");
      await input.waitFor();
      await input.fill(query);
    }
    async function first() {
      return palette.locator("[role=option][aria-selected=true]");
    }
    async function run(query, expected) {
      await open(query);
      const res = await first();
      assert.match(await res.innerText(), expected);
      await input.press("Enter");
      await palette.waitFor({ state: "hidden" });
    }
    async function focusOf() {
      return page.evaluate(() =>
        document.activeElement?.outerHTML.slice(0, 350),
      );
    }
    await page.getByRole("button", { name: "Open command palette" }).waitFor();
    await open("revlove");
    assert.match(await (await first()).innerText(), /Revolve profile/);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+Semicolon");
    await input.waitFor();
    assert.equal(await input.inputValue(), ":");
    await page.keyboard.type("named-parameters");
    await input.press("Enter");
    await page.getByRole("dialog", { name: "Named parameters" }).waitFor();
    await page.keyboard.press("Escape");
    await run("lathe", /Revolve profile/);
    await page.getByRole("dialog", { name: "Create feature" }).waitFor();
    await page.keyboard.press("Escape");
    await run("variables", /Named parameters/);
    const named = page.getByRole("dialog", { name: "Named parameters" });
    await named.waitFor();
    const expr = page.getByRole("textbox", {
      name: "Expression for barrel_length",
    });
    await expr.focus();
    await open("export step");
    assert.equal(await palette.getByRole("option").count(), 0);
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "hidden" });
    assert.equal(
      await expr.evaluate((el) => el === document.activeElement),
      true,
      await focusOf(),
    );
    await run(
      ":edit-expression-for-barrel-length",
      /Expression for barrel_length/i,
    );
    assert.equal(
      await expr.evaluate((el) => el === document.activeElement),
      true,
      await focusOf(),
    );
    await expr.fill("98 mm");
    await open("add parameter");
    await input.press("Enter");
    await named.getByLabel("Expression for dimension_6").waitFor();
    assert.equal(await expr.inputValue(), "98 mm");
    await named.getByRole("button", { name: "Cancel", exact: true }).click();
    await run("drawing title block", /Go to Drawing title block/);
    await page.waitForFunction(
      () =>
        document.activeElement?.getAttribute("aria-label") === "Drawing no.",
    );
    const drawingNo = page.getByLabel("Drawing no.");
    await drawingNo.fill("TM-LOCAL");
    await drawingNo.press("End");
    await drawingNo.press("Shift+Semicolon");
    assert.equal(await drawingNo.inputValue(), "TM-LOCAL:");
    assert.equal(await palette.isVisible(), false);
    await drawingNo.press("Escape");
    await run("ruler svg", /Go to Ruler SVG export/);
    await page.waitForFunction(
      () => document.querySelector(".tm-app").dataset.workspace === "Scales",
    );
    await run(":edit-major-line-width", /Edit Major line width/);
    const width = page.getByLabel("Major line width");
    assert(
      await width.evaluate(
        (el) => el.closest("details").open && document.activeElement === el,
      ),
    );
    await width.fill("0.22 mm");
    await width.press("Enter");
    const outline = page.getByRole("checkbox", { name: "Include layout outline in export", exact: true });
    assert.equal(await outline.isChecked(), false);
    await run(":include-blank-outline-in-export", /Include layout outline in export/);
    assert.equal(await outline.isChecked(), true);
    await run("include layout outline", /Include layout outline in export/);
    assert.equal(await outline.isChecked(), false);
    await page.getByRole("button", { name: "Ruler stock", exact: true }).click();
    await run(":include-blank-outline-in-export", /Include blank outline in export/);
    assert.equal(await page.getByRole("checkbox", { name: "Include blank outline in export" }).isChecked(), true);
    await open("width");
    const ids = await palette
      .getByRole("option")
      .evaluateAll((es) => es.map((e) => e.id));
    assert.equal(new Set(ids).size, ids.length);
    await input.press("ArrowDown");
    const selected = await input.getAttribute("aria-activedescendant");
    assert.equal(selected, ids[1]);
    await input.press("ArrowUp");
    assert.equal(await input.getAttribute("aria-activedescendant"), ids[0]);
    await captureViewport(page, join(process.cwd(), "test-evidence/browser/palette.png"));
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "hidden" });
    await run(":new-project", /New project/);
    await page
      .getByRole("dialog", { name: "New project" })
      .getByRole("button", { name: /Blank part/ })
      .click();
    await open("drill");
    const hole = await first();
    assert.match(await hole.innerText(), /Add Axial hole/i);
    assert.equal(await hole.getAttribute("aria-disabled"), "true");
    assert.match(await hole.innerText(), /Select a solid/);
    await input.press("Enter");
    assert(await palette.isVisible());
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Sketch", exact: true }).click();
    const sketch = page.getByRole("dialog", { name: "Sketch editor" });
    await sketch.waitFor();
    await run("rectangle", /rectangle/i);
    await sketch
      .getByText("Choose the first corner", { exact: false })
      .first()
      .waitFor();
    await open("remove selected item");
    assert.equal(await palette.getByRole("option").count(), 0);
    await page.keyboard.press("Escape");
    assert(await sketch.isVisible());
    assert.deepEqual(errors, []);
    console.log(
      "PASS keyboard palette, maker synonyms, typo-tolerant search, context-restricted modal actions, cancel focus, expression focus, sketch isolation, cross-workspace destinations, collapsed controls, checkbox activation, disabled reasons and keyboard selection.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
