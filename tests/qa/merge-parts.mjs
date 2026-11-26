import assert from "node:assert/strict";
import { appUrl, measure, openBrowser } from "./browser.mjs";
import { button, ready, saved } from "../projects/support.mjs";

function rectangle(id, left, width, height) {
  return { id, name:id + " profile", constraints:[],
    points:[[left,0],[left + width,0],[left + width,height],[left,height]]
      .map(([x,y]) => ({x:String(x),y:String(y)})) };
}
function extrude(id, name, sketchId, amount) {
  return { id, name, kind:"extrude", operation:"new", sketchId, amount, suppressed:false };
}
function installed(x, y, angle) {
  return { parent:"", kind:"fixed", axis:"Z", origin:["0","0","0"], offset:["0","0","0"],
    min:"0", max:"360", pitch:"0.75 mm", starts:"1", hand:1,
    placement:{ position:[String(x),String(y),"0"], rotation:["0","0",angle + " deg"] } };
}
const fixture = { id:"merge-placement", version:1, name:"Rotated mounting lug",
  parameters:[{name:"lug_height", expression:"2 mm"}],
  sketches:[rectangle("base-sketch",0,10,4), rectangle("lug-sketch",0,4,2)],
  features:[extrude("base","Mounting block","base-sketch","2 mm"),extrude("lug","Lug","lug-sketch","lug_height")],
  workspaces:{joints:{base:installed(50,20,90), lug:installed(50,32,180)}} };
const browser = await openBrowser();
try {
  const page = await browser.newPage({viewport:{width:1340,height:900}});
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  async function open(model) {
    await page.getByLabel("Open Turnmill project file").setInputFiles({
      name:"merge.turnmill", mimeType:"application/json", buffer:Buffer.from(JSON.stringify(model)),
    });
    await page.locator(".project-trigger").filter({hasText:model.name}).waitFor();
    await ready(page);
  }
  const dialog = page.getByRole("dialog",{name:"Merge parts",exact:true});
  async function chooseParts() {
    await dialog.getByLabel("Keep part",{exact:true}).selectOption("base");
    await dialog.getByLabel("Part to merge",{exact:true}).selectOption("lug");
  }
  await page.goto(appUrl);
  await saved(page);
  const gap = {...fixture, id:"merge-gap", name:"Separated components",
    sketches:[fixture.sketches[0], rectangle("lug-sketch",11,4,2)], workspaces:{}};
  await open(gap);
  const baseline = await measure(page);
  await page.getByRole("tab",{name:"Mounting block",exact:true}).click({button:"right"});
  await page.getByRole("menuitem",{name:/Merge parts/}).click();
  await chooseParts();
  await button(dialog,"Merge parts").click();
  await dialog.getByRole("alert").waitFor();
  assert(await button(dialog,"Position parts in Assembly").isVisible(), "gap can be repaired from the dialog");
  assert.deepEqual((await measure(page)).project, baseline.project, "failed union keeps both original parts and history");
  await button(dialog,"Cancel").click();
  await page.keyboard.press("u");
  await dialog.waitFor();
  await button(dialog,"Cancel").click();

  await open(fixture);
  await button(page,"Assembly").click();
  const assemblyCanvas = page.locator(".joint-stage canvas");
  await assemblyCanvas.waitFor();
  const original = await measure(page);
  assert.equal(original.bodies.length, 2);
  // Only the displayed assembly poses put the two parts into full face contact.
  // Fusing their untransformed local geometry would yield volume 80 instead of 96.
  await button(page,"Merge parts").click();
  assert.equal(await dialog.getByLabel("Merge positions").inputValue(), "assembly");
  await chooseParts();
  await button(dialog,"Merge parts").click();
  await dialog.waitFor({state:"hidden"});
  await ready(page);
  const merged = await measure(page);
  assert.equal(merged.bodies.length, 1);
  assert(merged.bodies[0].valid && merged.bodies[0].solids === 1);
  assert(Math.abs(merged.volume - 96) < 1e-6, "uses the rotated assembly pose");
  assert(Math.abs(merged.bodies[0].bbox[1][0] - 12) < 1e-6, "body geometry stays in the target frame");
  assert.equal(merged.project.features.filter(f => f.operation === "new")[0].id,"base");
  await button(page,"Undo").click(); await ready(page);
  const undo = await measure(page);
  assert.deepEqual(undo.project, original.project, "one Undo restores both components and their joints");
  assert.equal(undo.bodies.length, 2);
  await button(page,"Redo").click(); await ready(page); await saved(page);
  await page.reload(); await ready(page);
  const restored = await measure(page);
  assert.equal(restored.bodies.length, 1);
  assert(Math.abs(restored.volume - 96) < 1e-6);
  assert.deepEqual(restored.project.features, merged.project.features);
  assert.deepEqual(errors, []);
  console.log("PASS right-click merge, recover from a gap, captured assembly pose, one-part commit, undo, redo and autosave/reopen.");
} finally { await browser.close(); }
