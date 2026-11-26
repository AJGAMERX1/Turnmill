import assert from "node:assert/strict";
import { appUrl, openBrowser } from "./browser.mjs";
import { button, field, saved } from "../projects/support.mjs";

const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 870 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(appUrl);
  await saved(page);
  const profile = {
    id: "profile", name: "Sketch 1", constraints: [],
    points: [[0, 0], [10, 0], [10, 3], [0, 3]].map(([x, y]) => ({ x: String(x), y: String(y) })),
  };
  const params = [
    { name: "stock", label: "Stock length", expression: "20 mm" },
    { name: "slope", label: "Tip angle", kind: "angle", expression: "30 deg" },
  ];
  async function open(kind) {
    const project = {
      version: 1, id: kind, name: kind + " profile", parameters: params, sketches: [profile],
      features: [{ id: "body", name: "Body", kind, operation: "new", sketchId: profile.id,
        suppressed: false, amount: kind === "revolve" ? "360 deg" : "2 mm" }],
    };
    await field(page, "Open Turnmill project file").setInputFiles({
      name: kind + ".turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)),
    });
    await page.waitForFunction(async id => (await window.__cadTest?.snapshot())?.project?.id === id, kind);
    await button(page, "Edit sketch").click();
  }
  async function verifySolid(volume, expectedX) {
    await page.waitForFunction(async ({ volume, expectedX }) => {
      try {
        const s = await window.__cadTest.snapshot();
        return !s.busy && !s.error && s.bodies.length === 1 && s.bodies[0].valid &&
          Math.abs(s.volume - volume) < 0.00005 && Math.abs(s.bbox[1][0] - expectedX) < 0.00005;
      } catch { return false; }
    }, { volume, expectedX }, { timeout: 12000 });
    return await page.evaluate(async () => (await window.__cadTest.snapshot()).project);
  }
  const editor = page.getByRole("dialog", { name: "Sketch editor" });
  await open("revolve");
  await button(editor, "Draw a turned blank profile").click();
  await field(editor, "Place vertex X").fill("3 mm");
  await field(editor, "Axial length").fill("stock + 1/2 in");
  await field(editor, "Outside diameter").fill("12 mm");
  await field(editor, "Bore diameter").fill("13 mm");
  await button(editor, "Create blank profile").click();
  await editor.getByText("Set the bore to zero for solid stock", { exact: false }).waitFor();
  await field(editor, "Bore diameter").fill("6 mm");
  await button(editor, "Create blank profile").click();
  await editor.getByText("Fully constrained").waitFor();
  assert.equal(await field(editor, "Sketch axial length").inputValue(), "stock + 1/2 in");
  await button(editor, "Undo sketch edit").click();
  assert.equal(await field(editor, "Sketch axial length").inputValue(), "10 mm");
  await button(editor, "Redo sketch edit").click();
  await button(editor, "Finish sketch").click();
  await verifySolid(Math.PI * 27 * 32.7, 35.7);
  await field(page, "Stock length").fill("25 mm");
  await field(page, "Stock length").press("Enter");
  await verifySolid(Math.PI * 27 * 37.7, 40.7);
  await saved(page);
  await page.reload();
  await verifySolid(Math.PI * 27 * 37.7, 40.7);

  await open("extrude");
  await button(editor, "Draw a replacement rectangle").click();
  await field(editor, "Place vertex X").fill("2 mm");
  await field(editor, "Place vertex Y").fill("3 mm");
  await field(editor, "Width").fill("stock / 2");
  await field(editor, "Height").fill("5 mm");
  await button(editor, "Create rectangle").click();
  await field(editor, "Sketch height").fill("8 mm");
  await field(editor, "Sketch height").press("Enter");
  await button(editor, "Finish sketch").click();
  await verifySolid(160, 12);

  await button(page, "Edit sketch").click();
  await button(editor, "Draw a replacement polygon").click();
  await button(editor, "Place point").click();
  async function edge(length, angle) {
    await field(editor, "Edge length").fill(length);
    await field(editor, "Angle from X").fill(angle);
    await button(editor, "Add edge").click();
  }
  await edge("stock", "0 deg");
  await edge("1 cm", "slope");
  await button(editor, "Undo sketch edit").click();
  assert(await button(editor, "Close profile").isDisabled());
  await button(editor, "Redo sketch edit").click();
  await button(editor, "Close profile").click();
  await editor.getByText("Fully constrained", { exact: true }).waitFor();
  await button(editor, "Finish sketch").click();
  const expectedX = angle => 20 + 10 * Math.cos(angle * Math.PI / 180);
  let final = await verifySolid(100, expectedX(30));
  assert.deepEqual(final.sketches[0].constraints.filter(c => c.type === "angle").map(c => c.value), ["0 deg", "slope"]);
  await field(page, "Tip angle").fill("60 deg");
  await field(page, "Tip angle").press("Enter");
  final = await verifySolid(100 * Math.sqrt(3), expectedX(60));
  assert.equal(final.sketches[0].constraints.filter(c => c.type === "length")[0].value, "stock");
  assert.deepEqual(errors, []);
  console.log("PASS turned stock, bore validation, exact rectangle, driven segment lengths and angles, undo, redo, reload and B-rep volumes");
} finally {
  await browser.close();
}
