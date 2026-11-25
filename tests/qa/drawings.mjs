import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { captureViewport } from "./capture.mjs";
import { openBrowser, appUrl, measure } from "./browser.mjs";
const folder = resolve("test-evidence/drawings");
await mkdir(folder, { recursive: true });
const browser = await openBrowser({ displayEvidence: true }),
  errors = [],
  messages = [];
try {
  const p = await browser.newPage({
    viewport: { width: 1470, height: 950 },
    acceptDownloads: true,
  });
  p.setDefaultTimeout(240000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      messages.push({ type: m.type(), message: m.text() });
  });
  await p.goto(appUrl);
  await measure(p);
  await p
    .getByLabel("Open Turnmill project file")
    .setInputFiles(resolve("examples/twist-pen.turnmill"));
  await p.waitForFunction(() =>
    document.querySelector(".status-bar")?.innerText.includes("4 bodies"),
  );
  const props = await measure(p);
  assert.equal(props.bodies.length, 4);
  await writeFile(
    folder + "/pen-measurements.json",
    JSON.stringify(
      {
        mass: props.mass,
        volume: props.volume,
        area: props.area,
        centerOfMass: props.centerOfMass,
        bodies: props.bodies,
      },
      null,
      2,
    ),
  );
  await captureViewport(p, folder + "/turnmill-pen.png");
  await p.getByRole("button", { name: "Drawing", exact: true }).click();
  await p.getByRole("img", { name: "Linked part drawing" }).waitFor();
  const collect = async (name) => {
    await p
      .getByRole("button", { name: "Download PDF", exact: true })
      .waitFor();
    const labels = await p.locator(".tm-page-pick button").allInnerTexts();
    assert.ok(labels.length >= 2);
    const task = p.waitForEvent("download");
    await p.getByRole("button", { name: "Download PDF", exact: true }).click();
    await (await task).saveAs(folder + "/" + name + ".pdf");
    for (let i = 0; i < labels.length; i++) {
      await p.locator(".tm-page-pick button").nth(i).click();
      await p
        .locator(".tm-paper-stage")
        .screenshot({
          path: folder + "/" + name + "-sheet-" + (i + 1) + ".png",
        });
    }
    return labels;
  };
  const part = await collect("barrel");
  await p.getByLabel("Drawing source").selectOption("assembly");
  await p.getByRole("button", { name: /Exploded assembly/ }).waitFor();
  await p.getByLabel("Include assembly section").check();
  await p
    .getByRole("button", { name: /Section A–A|Assembly section/i })
    .last()
    .waitFor();
  const assembly = await collect("assembly");
  await writeFile(
    folder + "/browser.json",
    JSON.stringify({ part, assembly, errors, messages }, null, 2),
  );
  assert.equal(errors.length, 0);
  console.log({ part, assembly, errors });
} finally {
  await browser.close();
}
