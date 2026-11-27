import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import {
  button,
  field,
  input,
  newProject,
  sample,
  snap,
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
  const coupling = p.getByRole("region", { name: "Cam coupling" });
  await coupling.getByText("2.000 mm", { exact: true }).waitFor();
  for (const [rotation, refillX] of [[180, -0.625], [0, 2], [180, -0.625]]) {
    await button(panel, "Twist cap").click();
    await p.waitForFunction((angle) => Number(document.querySelector('[aria-label="Drive value"]')?.value) === angle, rotation);
    await coupling.getByText(refillX.toFixed(3) + " mm", { exact: true }).waitFor();
    const pose = await snap(p);
    const index = pose.joints.ids.indexOf("pen-refill");
    assert(index >= 0);
    const tip = pose.bodies[index].bbox[0][0] + pose.joints.matrices[index][12];
    assert(Math.abs(tip - (rotation ? -2.125 : 0.5)) < 0.001, "Installed refill tip crosses the nose of the barrel");
  }
  await button(p, "Save current pose").click({ timeout: 240000 });
  const moved = await sample(s, "04-refill-extended");
  assert.equal(moved.project.workspaces.penGuide.refillTravel, -2.625);
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

export async function pen(s, { keepM10 = false, checkpoint = sample } = {}) {
  const p = s.page;
  await openPen(p);
  if (keepM10) {
    await p.keyboard.press("Alt+r");
    const name = p.getByRole("dialog", { name: "Rename project" });
    await field(name, "Project name").fill("M10 twist pen");
    await button(name, "Save name").click();
  }
  await button(p, "All parameters").click();
  const d = p.getByRole("dialog");
  await input(d, "Expression for outer_diameter", "12.3 mm", false);
  await button(d, "Apply parameters").click();
  await ready(p);
  const m10 = await checkpoint(s, "M10-barrel");
  assert.equal(m10.bodies.length, 4);
  assert.equal(m10.values.thread_major, 10);
  assert.equal(m10.values.thread_pitch, 0.75);
  assert(m10.bodies.every((b) => b.valid && b.solids === 1));
  if (!keepM10) {
    await native(s, "M10-pen");
    await stepExport(s, "M10-pen");
    await button(p, "Undo").click();
    await ready(p);
  }
  await p
    .locator(".tree-item")
    .filter({ hasText: "Barrel" })
    .filter({ has: p.getByText("Barrel", { exact: true }) })
    .first()
    .click();
  const base = await checkpoint(s, "01-threaded-pen");
  assert(Math.abs(base.values.thread_major - (keepM10 ? 10 : 9.7)) < 0.00001);
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
  const cut = await checkpoint(s, "02-knurled-grip");
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
  const marked = await checkpoint(s, "03-engraved-name");
  assert(marked.volume < cut.volume);
  await native(s, "twist-pen");
  await stepExport(s, "twist-pen");
  await button(p, "Assembly").click();
  await field(p, "Component").selectOption("pen-cap");
  await field(p, "Drive value").and(p.locator(":enabled")).waitFor({ timeout: 240000 });
  await input(p, "Drive value", "360 deg");
  await p.getByText("Axial travel 0.750 mm", { exact: true }).waitFor();
  await button(p, "Save current pose").click({ timeout: 240000 });
  await checkpoint(s, "04-mated");
  await field(p, "Compare with").selectOption("barrel-revolve");
  assert.equal(await field(p, "Component").inputValue(), "pen-cap");
  const result = await jointReport(p, "Full travel");
  await writeFile(join(s.dir, "clearance.txt"), result);
  await checkpoint(s, "05-travel");
  assert.match(result, /clear throughout|throughout travel/i);
}
export async function drawing(
  s,
  source,
  { currentProject = false, checkpoint = sample } = {},
) {
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
  } else if (!currentProject) await openPen(p);
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
  await checkpoint(s, "01-front-section");
  await p.getByRole("button", { name: /Section detail/ }).click();
  await checkpoint(s, "02-thread-end-detail");
  await p.getByRole("button", { name: /Dimensions 1/ }).click();
  await checkpoint(s, "03-dimensions");
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
  await checkpoint(s, "04-exploded");
  await p.getByRole("button", { name: /Bill of materials/ }).click();
  await checkpoint(s, "05-bom");
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
