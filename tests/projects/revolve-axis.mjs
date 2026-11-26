import assert from "node:assert/strict";
import { measure } from "../qa/browser.mjs";
import { button, field, input, newProject, profile, ready } from "./support.mjs";

async function drawHalf(editor, y) {
  await button(editor, "Draw a replacement rectangle").click();
  for (const [x, height] of [[0, 0], [12, y]]) {
    await input(editor, "Place vertex X", x, false);
    await input(editor, "Place vertex Y", height, false);
    await button(editor, "Place point").click();
  }
}

export async function revolveAxis({ page: p }) {
  await newProject(p, /Blank part/);
  await profile(p, [[0, -2], [12, 2]]);
  const tools = p.locator(".model-tools");
  await button(tools, "Revolve").click();
  const dialog = p.getByRole("dialog", { name: "Create feature" });
  const editor = p.getByRole("dialog", { name: "Sketch editor" });
  const requestedName = "Quarter barrel";
  await dialog.getByRole("alert").filter({ hasText: /crosses the dashed X axis/ }).waitFor();
  assert(await button(dialog, "Create feature").isDisabled());
  assert.equal((await measure(p)).project.features.length, 0);
  await input(dialog, "Feature name", requestedName, false);
  await input(dialog, "Angle about X", "90 deg", false);
  await button(dialog, "Edit sketch").click();
  await editor.getByText("X · revolve axis (Y = 0)").waitFor();
  await button(editor, "Cancel").click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await field(dialog, "Angle about X").inputValue(), "90 deg");
  await button(dialog, "Edit sketch").click();
  await drawHalf(editor, 2);
  await button(editor, "Finish sketch").click();
  assert.equal(await field(dialog, "Feature name").inputValue(), requestedName);
  assert.equal(await field(dialog, "Angle about X").inputValue(), "90 deg");
  await button(dialog, "Create feature").click();
  await ready(p);
  const working = await measure(p);
  assert.equal(working.project.features.length, 1);
  assert(Math.abs(working.volume - 12 * Math.PI) < 1e-4);

  // Recover an invalid existing revolve in place, including a negative-radius half profile.
  const legacy = structuredClone(working.project);
  legacy.sketches[0].points = [[0, -2], [12, -2], [12, 2], [0, 2]].map(([x, y]) => ({ x: String(x), y: String(y) }));
  legacy.sketches[0].constraints = [];
  await field(p, "Open Turnmill project file").setInputFiles({
    name: "crossed-axis.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacy)),
  });
  const warning = p.locator(".stage-error").filter({ hasText: /crosses the dashed X axis/ });
  await warning.getByRole("button", { name: "Edit " + legacy.sketches[0].name }).waitFor();
  await p.locator(".tree-item.sketch-node").click({ button: "right" });
  await p.getByRole("menuitem", { name: "Revolve", exact: true }).click();
  const edit = p.getByRole("dialog", { name: "Edit feature" });
  await button(edit, "Edit sketch").click();
  await drawHalf(editor, -2);
  await editor.getByLabel("Sketch canvas").click({ button: "right" });
  await p.getByRole("menuitem", { name: "Revolve", exact: true }).click();
  assert.equal(await field(edit, "Feature name").inputValue(), requestedName);
  assert.equal(await field(edit, "Angle about X").inputValue(), "90 deg");
  await button(edit, "Apply changes").click();
  await ready(p);
  const repaired = await measure(p);
  assert.equal(repaired.project.features.length, 1);
  assert.equal(repaired.project.features[0].id, legacy.features[0].id);
  assert(Math.abs(repaired.volume - 12 * Math.PI) < 1e-4);
}
