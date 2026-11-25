import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import {
  button,
  field,
  input,
  newProject,
  sample,
  native,
  ready,
  download,
  operation,
  stepExport,
  jointReport,
} from "./support.mjs";

async function openPen(p) {
  await newProject(p, /Twist pen assembly/);
  await ready(p);
}
export async function guide(s) {
  const p = s.page,
    t = Date.now(),
    panel = p.getByRole("region", { name: "Guided pen walkthrough" });
  await button(p, "Pen walkthrough").first().click();
  await button(p, "Start a new guided pen").click();
  await p
    .getByRole("img", { name: "Barrel half-profile above the X turning axis" })
    .waitFor();
  await sample(s, "01-start-profile");
  await input(p, "Barrel length", "4 in");
  await p.getByText("Barrel profile · 101.6 mm").waitFor();
  await button(panel, "Revolve barrel").click();
  assert.equal(await field(p, "Angle about X").inputValue(), "360 deg");
  await button(p.getByRole("dialog"), "Create feature").click();
  const b = await sample(s, "02-revolved");
  assert.equal(b.bodies.length, 1);
  assert(
    Math.abs(b.bodies[0].bbox[1][0] - b.bodies[0].bbox[0][0] - 101.6) < 0.01,
  );
  await button(panel, "Add threaded cap").click();
  const c = await sample(s, "03-cap");
  assert.equal(c.bodies.length, 2);
  await button(panel, "Add refill and clip").click();
  await field(p, "Component").selectOption("pen-cap");
  await button(p, "Find rotation control").click();
  await input(p, "Drive value", "360 deg");
  await p.getByText("Axial travel 0.750 mm", { exact: true }).waitFor();
  await button(p, "Save current pose").click({ timeout: 240000 });
  await sample(s, "04-cap-at-one-turn");
  await button(p, "Find clearance check").click();
  await button(p, "Full travel").click();
  await panel
    .getByText("Make the barrel drawing", { exact: true })
    .waitFor({ timeout: 360000 });
  assert.match(await panel.innerText(), /Clearance throughout travel ≥ 0\.04/);
  await sample(s, "05-full-travel");
  await button(p, "Open barrel drawing").click();
  await p
    .getByRole("img", { name: "Linked part drawing" })
    .waitFor({ timeout: 240000 });
  await sample(s, "06-drawing-ready");
  await download(
    p,
    () => button(p, "Download PDF").click(),
    join(s.dir, "guided-barrel.pdf"),
  );
  await panel.getByText("Walkthrough complete", { exact: true }).waitFor();
  await sample(s, "07-finished");
  await native(s, "completed-guide");
  await writeFile(
    join(s.dir, "timing.json"),
    JSON.stringify({
      seconds: (Date.now() - t) / 1000,
      actor: "Playwright, evidence capture included",
    }),
  );
}

export async function pen(s) {
  const p = s.page;
  await openPen(p);
  await button(p, "All parameters").click();
  const d = p.getByRole("dialog");
  await input(d, "Expression for outer_diameter", "12.3 mm", false);
  await button(d, "Apply parameters").click();
  await p.waitForFunction(
    () =>
      /Rebuild failed|^Ready/.test(
        document.querySelector(".status-bar")?.innerText || "",
      ),
    null,
    { timeout: 180000 },
  );
  const error = await p.locator(".stage-error").allTextContents();
  if (!error.length)
    throw Error(
      "XPASS UI-001: verify the M10 pen now builds and retire this mark.",
    );
  assert.match(error.join(" "), /Barrel.*Barrel thread.*invalid edge or face/);
  await sample(s, "UI-001-M10-barrel", { check: false });
  await native(s, "UI-001-M10-pen");
  console.log(
    "XFAIL UI-001: 12.3 mm OD should build the 10 mm major thread but the barrel is invalid.",
  );
  await button(p, "Undo").click();
  await ready(p);
  await p
    .locator(".tree-item")
    .filter({ hasText: "Barrel" })
    .filter({ has: p.getByText("Barrel", { exact: true }) })
    .first()
    .click();
  const base = await sample(s, "01-threaded-pen");
  assert(Math.abs(base.values.thread_major - 9.7) < 0.00001);
  assert.equal(base.values.thread_pitch, 0.75);
  await operation(
    p,
    "knurl",
    {
      End: "start",
      Pattern: "straight",
      "Cylinder diameter": "outer_diameter",
      "Grooves per direction": "8",
      "Band length": "8 mm",
      "Offset from end": "16 mm",
      "Cut depth": "0.12 mm",
    },
    { add: true },
  );
  const cut = await sample(s, "02-knurled-grip");
  assert(cut.volume < base.volume);
  await operation(
    p,
    "mark",
    {
      End: "start",
      Artwork: "text",
      Method: "engrave",
      Inscription: "ANA",
      "Artwork height": "1.8 mm",
      "Cut depth": "0.12 mm",
      "Offset from end": "34 mm",
      "Angle around barrel": "0 deg",
    },
    { add: true },
  );
  const marked = await sample(s, "03-engraved-name");
  assert(marked.volume < cut.volume);
  await native(s, "twist-pen");
  await stepExport(s, "twist-pen");
  await button(p, "Assembly").click();
  await field(p, "Component").selectOption("pen-cap");
  await input(p, "Drive value", "360 deg");
  await p.getByText("Axial travel 0.750 mm", { exact: true }).waitFor();
  await button(p, "Save current pose").click({ timeout: 240000 });
  await sample(s, "04-mated");
  const result = await jointReport(p, "Full travel");
  await writeFile(join(s.dir, "clearance.txt"), result);
  await sample(s, "05-travel");
  assert.match(result, /clear throughout|throughout travel/i);
}
export async function drawing(s, source) {
  const p = s.page;
  if (source) {
    await field(p, "Open Turnmill project file").setInputFiles(source);
    await p
      .locator(".tree-item")
      .filter({ hasText: "ANA" })
      .first()
      .waitFor({ timeout: 500 })
      .catch(() => {});
    await ready(p);
  } else await openPen(p);
  await button(p, "Drawing").click();
  await p
    .getByRole("img", { name: "Linked part drawing" })
    .waitFor({ timeout: 240000 });
  const detail = p.locator("summary", {
    hasText: "Annotations and detail views",
  });
  await detail.click();
  await field(p, "Enlarged section detail").check();
  await field(p, "Detail width").fill("shoulder_length");
  await field(p, "Detail width").press("Enter");
  await button(p, /Views and section/).click();
  await sample(s, "01-front-section");
  await p.getByRole("button", { name: /Section detail/ }).click();
  await sample(s, "02-thread-end-detail");
  await p.getByRole("button", { name: /Dimensions 1/ }).click();
  await sample(s, "03-dimensions");
  await download(
    p,
    () => button(p, "Download PDF").click(),
    join(s.dir, "barrel.pdf"),
  );
  await field(p, "Drawing source").selectOption("assembly");
  await p
    .getByRole("button", { name: /Exploded assembly/ })
    .waitFor({ timeout: 360000 });
  await p.getByRole("button", { name: /Exploded assembly/ }).click();
  await sample(s, "04-exploded");
  await p.getByRole("button", { name: /Bill of materials/ }).click();
  await sample(s, "05-bom");
  await download(
    p,
    () => button(p, "Download PDF").click(),
    join(s.dir, "assembly.pdf"),
  );
  await native(s, "drawing-set");
}

export async function inscription(s, nativeFile) {
  const p = s.page;
  await field(p, "Open Turnmill project file").setInputFiles(nativeFile);
  const mark = p
    .locator(".tree-item.nested")
    .filter({ hasText: "Surface mark" });
  await mark.waitFor();
  await ready(p);
  await mark.click();
  const d = p.getByRole("dialog");
  assert.equal(await field(d, "Inscription").inputValue(), "ANA");
  assert.equal(await field(d, "Cut depth").inputValue(), "0.12 mm");
  assert.equal(await field(d, "Artwork height").inputValue(), "1.8 mm");
  const model = await sample(s, "01-typed-inscription");
  const savedMark = model.project.features
    .find((f) => f.name === "Barrel")
    .finishes.find((f) => f.kind === "mark");
  assert.equal(savedMark.text, "ANA");
  await button(d, "Cancel").click();
}
