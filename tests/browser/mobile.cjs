const { chromium } = require("playwright-core"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  fs = require("node:fs/promises");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const c = await browser.newContext({
        viewport: { width: 390, height: 825 },
        screen: { width: 390, height: 825 },
        isMobile: true,
        hasTouch: true,
      }),
      p = await c.newPage();
    p.setDefaultTimeout(16000);
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const base = process.env.TURNMILL_URL || "http://127.0.0.1:4197/",
      addr = (n) => p.getByRole("button", { name: n, exact: true }),
      guide = p.getByRole("region", { name: "Guided pen walkthrough" }),
      shot = (n) =>
        p.screenshot({
          path: path.resolve("test-evidence/browser", n + ".png"),
        });
    const metrics = () =>
      p.evaluate(() =>
        Object.fromEntries(
          [
            "body",
            ".app-header",
            ".workspace-bar",
            ".work-area",
            ".model-tools",
            ".model-space",
            ".tree-pane",
            ".inspector",
            ".pen-guide-panel",
            ".command-palette",
            ".palette-results",
          ].map((k) => {
            const e = document.querySelector(k);
            if (!e) return [k, null];
            const r = e.getBoundingClientRect();
            return [
              k,
              {
                left: r.x,
                right: r.right,
                top: r.y,
                bottom: r.bottom,
                scrollW: e.scrollWidth,
                clientW: e.clientWidth,
                overflow: getComputedStyle(e).overflowX,
              },
            ];
          }),
        ),
      );
    await p.goto(base);
    await p.getByText("Saved locally", { exact: true }).waitFor();
    await addr("Show model browser").waitFor();
    await shot("01-start");
    console.log("Initial", await metrics());
    await addr("Show model browser").tap();
    const tree = p.getByRole("complementary", { name: "Model browser" });
    await tree.waitFor();
    await tree.getByText("Feature history", { exact: false }).first().waitFor();
    const sketch = tree.locator(".sketch-node").first(),
      feature = tree.locator('.tree-item[title^="Select feature"]').first();
    await sketch.tap();
    assert.match(await sketch.getAttribute("class"), /active/);
    await feature.tap();
    assert.match(await feature.getAttribute("class"), /active/);
    await shot("02-browser");
    await addr("Hide model browser").tap();
    assert.equal(await tree.count(), 0);
    await addr("Hide inspector").tap();
    await addr("Show inspector").tap();
    await p
      .locator(".inspector")
      .getByText("Dimensions", { exact: true })
      .waitFor();
    await addr("Pen walkthrough").first().tap();
    await addr("Start a new guided pen").tap();
    await guide.getByText("Revolve the barrel").waitFor();
    await shot("03-guide");
    const length = p.getByLabel("Barrel length", { exact: true });
    await length.tap();
    await length.fill("4 in");
    await length.press("Enter");
    await p.getByText("Barrel profile · 101.6 mm", { exact: true }).waitFor();
    await shot("04-edited-dimension");
    await addr("Revolve barrel").tap();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Create feature" })
      .tap();
    await guide.getByText("Thread the cap").waitFor();
    await addr("Open command palette").tap();
    const palette = p.getByRole("dialog", { name: "Command palette" }),
      q = palette.getByRole("combobox");
    await q.fill("Named parameters");
    await shot("05-palette");
    await palette
      .getByRole("option", { name: /Named parameters/i })
      .first()
      .tap();
    await p.getByRole("dialog", { name: "Named parameters" }).waitFor();
    await p.keyboard.press("Escape");
    await p
      .getByRole("dialog", { name: "Named parameters" })
      .waitFor({ state: "hidden" });
    for (const w of [390, 320, 650]) {
      await p.setViewportSize({ width: w, height: 825 });
      const m = await metrics();
      const buttons = await p
        .locator(".model-tools")
        .evaluate((el) =>
          [...el.querySelectorAll("button")].map((b) => [
            b.innerText || b.title,
            b.getBoundingClientRect().x,
            b.getBoundingClientRect().right,
          ]),
        );
      console.log("width", w, JSON.stringify(m), JSON.stringify(buttons));
      assert(m[".app-header"].scrollW <= w, "cropped app header at " + w);
      assert(m.body.scrollW <= w, "body horizontally overflowed at " + w);
      const toolbar = m[".model-tools"];
      assert(
        toolbar.scrollW <= toolbar.clientW + 1 ||
          ["auto", "scroll"].includes(toolbar.overflow),
        "model tools overflow without scrolling at " + w,
      );
      const bar = m[".workspace-bar"];
      assert(
        bar.scrollW <= bar.clientW + 1 ||
          ["auto", "scroll"].includes(bar.overflow),
        "mode tabs overflow at " + w,
      );
      await shot("06-width-" + w);
      await addr("Advanced tools").tap();
      await p.getByRole("dialog").waitFor();
      await p.keyboard.press("Escape");
      await addr("Show model browser").tap();
      await p
        .locator('.compact-tree .tree-item[title^="Select feature"]')
        .tap();
      await addr("Hide model browser").tap();
      await p.locator(".guide-help-entry").tap();
      await p.getByRole("dialog").waitFor();
      await p.keyboard.press("Escape");
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS model browser toggle, sketch/feature selection, inspector restore, editing guided dimension, barrel creation, searchable command execution and contained tools at phone and tablet widths",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
