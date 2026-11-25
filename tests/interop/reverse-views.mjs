import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const out = resolve(process.env.QA_INTEROP_OUT || "test-evidence/interop");
const records = JSON.parse(
  await readFile(join(out, "freecad-sources.json"), "utf8"),
);
const b = await chromium.launch({
  headless: true,
  executablePath: process.env.QA_CHROMIUM || chromium.executablePath(),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const p = await b.newPage({ viewport: { width: 1250, height: 790 } });
  p.setDefaultTimeout(120000);
  await p.goto(process.env.QA_URL || "http://127.0.0.1:4179/");
  const issues = [];
  p.on("pageerror", (e) => issues.push(String(e)));
  for (const [name, parts] of Object.entries(records)) {
    const blank = JSON.parse(
      await readFile(join(out, "block.turnmill"), "utf8"),
    );
    blank.name = name;
    blank.features = [];
    blank.sketches = [];
    await p
      .getByLabel("Open Turnmill project file")
      .setInputFiles({
        name: name + ".turnmill",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(blank)),
      });
    await p.waitForFunction(
      (n) =>
        document.querySelector(".project-trigger")?.textContent.includes(n),
      name,
    );
    await p.locator(".project-trigger").click();
    await p.getByRole("button", { name: /Import CAD file/ }).click();
    const dialog = p.getByRole("dialog");
    await dialog
      .locator("input[type=file]")
      .setInputFiles(join(out, name + ".step"));
    await dialog.getByRole("button", { name: "Import bodies" }).click();
    await dialog.waitFor({ state: "hidden" });
    await p.waitForFunction(
      (t) =>
        document.querySelector(".status-bar")?.innerText.includes("Ready") &&
        document.querySelector(".status-bar")?.innerText.includes(t),
      parts.length === 1 ? "1 body" : parts.length + " bodies",
    );
    await p.keyboard.press("f");
    await p.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    await p
      .locator(".solid-viewport")
      .screenshot({ path: join(out, name + ".app-iso.png") });
    console.log(name, parts.length);
  }
  if (issues.length) throw Error(issues.join("\n"));
  await writeFile(
    join(out, "reverse-ui.json"),
    JSON.stringify({ cases: Object.keys(records), errors: issues }, null, 2),
  );
} finally {
  await b.close();
}
