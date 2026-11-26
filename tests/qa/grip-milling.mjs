import assert from "node:assert/strict";
import { appUrl, measure, openBrowser } from "./browser.mjs";
import { button, ready, saved } from "../projects/support.mjs";

function sleeve(id, name, start, end) {
  const sketchId = id + "-profile";
  return {
    sketch: { id: sketchId, name: name + " profile", constraints: [],
      points: [[start,3],[start,6],[end,6],[end,3]].map(([x,y]) => ({x:String(x), y:String(y)})) },
    feature: { id, name, sketchId, kind: "revolve", operation: "new", amount: "360 deg", suppressed: false },
  };
}
const parts = [sleeve("barrel", "Grip barrel", 0, 30), sleeve("spacer", "Rear spacer", 45, 56)];
const project = {
  version: 1, id: "grip-qa", name: "Grip fixture", parameters: [],
  sketches: parts.map(p => p.sketch), features: parts.map(p => p.feature),
};
const browser = await openBrowser();
try {
  const page = await browser.newPage({viewport: {width: 1360, height: 845}});
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(appUrl); await saved(page);
  await page.getByLabel("Open Turnmill project file").setInputFiles({
    name: "grip.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.locator(".project-trigger").filter({hasText:"Grip fixture"}).waitFor();
  await ready(page);
  const original = await measure(page);
  const menu = page.getByRole("menu", {name: "Grip barrel actions", exact: true});
  async function openGrip() {
    await menu.getByRole("menuitem", {name: /Mill grip/}).click();
    const dialog = page.getByRole("dialog", {name: /Grip milling.*Grip barrel/i});
    await dialog.waitFor();
    return dialog;
  }
  await button(page, "Pen Studio").click();
  await page.locator(".view-select").click();
  await page.locator(".view-holder .dropdown button").filter({hasText:"Front"}).click();
  const canvas = page.locator(".solid-viewport canvas:visible");
  const box = await canvas.boundingBox();
  assert(box);
  // Front projection makes the long barrel occupy the left half of the frame.
  for (const fx of [.35, .3, .4, .25, .45, .2]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height / 2, {button:"right"});
    if (await menu.isVisible()) break;
    await page.keyboard.press("Escape");
  }
  let dialog = await openGrip();
  await button(dialog, "Flutes").click();
  assert.equal(await button(dialog,"Flutes").getAttribute("aria-pressed"), "true");
  await button(dialog,"Apply grip").click(); await dialog.waitFor({state:"hidden"});
  await ready(page);
  const fluted = await measure(page);
  assert.equal(fluted.project.features[0].finishes[0].style, "flutes");
  assert(fluted.bodies[0].volume < original.bodies[0].volume);
  assert.equal(fluted.bodies[1].volume, original.bodies[1].volume);
  assert.equal(fluted.project.features[1].finishes?.length ?? 0, 0);

  await button(page,"Part").click();
  const history = page.locator(".history-list");
  await history.locator(".tree-item").filter({has:page.getByText("Grip barrel",{exact:true})}).click({button:"right"});
  dialog = await openGrip();
  await button(dialog,"Cross-cut").click();
  assert.equal(await button(dialog,"Cross-cut").getAttribute("aria-pressed"),"true");
  await button(dialog,"Cancel").click();
  const finish = history.locator(".tree-item.nested").first();
  await finish.click();
  dialog = page.getByRole("dialog", {name:/Grip milling.*Grip barrel/i});
  await button(dialog,"Rings").click();
  await dialog.getByLabel("Groove count", {exact:true}).fill("4");
  await button(dialog,"Apply grip").click(); await dialog.waitFor({state:"hidden"}); await ready(page);
  const rings = await measure(page);
  const edited = rings.project.features[0].finishes;
  assert.equal(edited.length,1);
  assert.equal(edited[0].style,"rings");
  assert.equal(edited[0].id,fluted.project.features[0].finishes[0].id);
  assert.notEqual(rings.bodies[0].volume, fluted.bodies[0].volume);
  await button(page,"Undo").click(); await ready(page);
  const undone = await measure(page);
  assert.deepEqual(undone.project.features[0].finishes, fluted.project.features[0].finishes);
  assert(Math.abs(undone.bodies[0].volume - fluted.bodies[0].volume) < 1e-6);
  await button(page,"Redo").click(); await ready(page); await saved(page);
  await page.reload(); await ready(page);
  assert.equal((await measure(page)).project.features[0].finishes[0].style,"rings");
  assert.deepEqual(errors,[]);
  console.log("PASS mill grip from the rendered barrel and feature history, choose patterns, edit an existing cut, undo, redo and reopen.");
} finally { await browser.close(); }
