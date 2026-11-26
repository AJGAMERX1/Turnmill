import assert from "node:assert/strict";
import { openBrowser, appUrl, measure } from "./browser.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";

const browser = await openBrowser();
try {
  const p = await browser.newPage({ viewport: { width: 1390, height: 920 } });
  p.setDefaultTimeout(30000);
  const pageErrors = [];
  p.on("pageerror", (error) => pageErrors.push(error.message));
  await p.goto(appUrl);
  await saved(p);
  const base = { version: 1, parameters: [], id: "inspector-turned", name: "Custom pin",
    sketches: [{ id: "profile", name: "Sketch 1", constraints: [],
      points: [[0, 3], [0, 5], [2, 6], [18, 6], [20, 5], [20, 3]].map(([x,y]) => ({x: String(x), y: String(y)})) }],
    features: [{ id: "body", name: "Revolve 1", sketchId: "profile", kind: "revolve", operation: "new", amount: "360 deg", suppressed: false }],
  };
  const open = async (project) => {
    await field(p, "Open Turnmill project file").setInputFiles({
      name: "sketch.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)),
    });
    await p.locator(".tree-item").filter({ has: p.getByText("Sketch 1", {exact:true}) }).first().click();
    await ready(p);
  };
  const edit = async (label, text) => {
    await field(p, label).fill(text);
    await field(p, label).press("Enter");
    await p.locator(".selection-dimensions:not(:disabled)").waitFor();
  };
  const near = (x, y, tolerance = 0.00002) => assert(Math.abs(x - y) <= tolerance, `${x} differs from ${y}`);
  const turnedVolume = (length, outside, bore) => {
    const outer = outside / 2, inner = bore / 2;
    const end = inner + (outer - inner) * (2 / 3);
    return Math.PI * length * (0.8 * outer ** 2 + 0.2 * (end ** 2 + end * outer + outer ** 2) / 3 - inner ** 2);
  };
  async function verify(volume) {
    await p.waitForFunction(async (expected) => {
      try {
        const state = await window.__cadTest.snapshot();
        return !state.busy && !state.error && Math.abs(state.volume - expected) <= 0.00002;
      } catch { return false; }
    }, volume, { timeout: 30000, polling: 100 });
    const state = await measure(p);
    assert.equal(state.bodies.length, 1);
    assert.equal(state.bodies[0].valid, true);
    near(state.volume, volume);
    return state;
  }
  await open(base);
  assert.equal(await field(p,"Axial length").inputValue(), "20 mm");
  assert.equal(await field(p,"Outside diameter").inputValue(), "12 mm");
  assert.equal(await field(p,"Bore diameter").inputValue(), "6 mm");
  await edit("Axial length", "1 in + 14.6 mm");
  await verify(turnedVolume(40,12,6));
  await edit("Outside diameter", "16 mm");
  await verify(turnedVolume(40,16,6));
  await edit("Bore diameter", "8 mm");
  const sized = await verify(turnedVolume(40,16,8));
  near(sized.bbox[1][0],40);
  near(sized.bbox[1][1],8);
  await edit("Bore diameter", "25 mm");
  await p.getByRole("alert").filter({hasText:"outside diameter above it"}).waitFor();
  await verify(turnedVolume(40,16,8));
  await edit("Revolve angle", "180 deg");
  await verify(turnedVolume(40,16,8) / 2);
  await button(p, "Undo").click();
  await verify(turnedVolume(40,16,8));
  await saved(p);
  await p.reload();
  await ready(p);
  assert.equal(await field(p, "Bore diameter").inputValue(),"8 mm");
  assert.equal(await field(p, "Axial length").inputValue(),"1 in + 14.6 mm");

  const block = structuredClone(base);
  block.id = "inspector-block";
  block.parameters = [{name:"stock", label:"Stock length", expression:"10 mm"}];
  block.sketches[0].points = [[3,2],[13,2],[13,6],[3,6]].map(([x,y])=>({x:String(x), y:String(y)}));
  block.sketches[0].constraints = ["horizontal","vertical","horizontal","vertical"].map((type,i)=>({id:String(i), type, indices:[i]}));
  Object.assign(block.features[0], { kind:"extrude", name:"Extrude 1", amount:"5 mm" });
  await open(block);
  await edit("Profile width", "stock * 2");
  await verify(20 * 4 * 5);
  await edit("Stock length", "12 mm");
  const flat = await verify(24 * 4 * 5);
  near(flat.bbox[0][0],3);
  near(flat.bbox[1][0],27);
  assert.equal(await field(p,"Profile width").inputValue(),"stock * 2");
  await edit("Extrusion depth", "1/2 in");
  await verify(24 * 4 * 12.7);

  const constrained = structuredClone(block);
  constrained.id = "inspector-drivers";
  constrained.sketches[0].constraints.push({ id:"side", type:"length", indices:[0], value:"10 mm" });
  await open(constrained);
  assert.equal(await field(p, "Profile width").count(), 0);
  await edit("Edge 1 length", "16 mm");
  await verify(16 * 4 * 5);
  await button(p, "Edit point coordinates").click();
  await field(p, "Profile point").selectOption("2");
  assert(await field(p, "P3 X").isVisible());

  const lower = structuredClone(base);
  lower.id = "below-axis";
  lower.sketches[0].points.forEach((q) => { q.y = String(-Number(q.y)); });
  lower.sketches[0].constraints = [{id:"fixed-end", type:"y", indices:[2], value:"-6 mm"}];
  await open(lower);
  await edit("Outside diameter", "18 mm");
  const mirrored = await verify(turnedVolume(20,18,6));
  assert.equal(Number.parseFloat(mirrored.project.sketches[0].constraints[0].value), -9);
  await button(p, "Edit point coordinates").click();
  await field(p, "Profile point").selectOption("2");
  await edit("P3 radius (Y)", "missing_symbol");
  await p.getByRole("alert").filter({hasText: "Unknown parameter"}).waitFor();
  await verify(turnedVolume(20,18,6));
  await edit("P3 radius (Y)", "-8 mm");
  const segment = (length, r1, r2) => length * (r1 * r1 + r1 * r2 + r2 * r2) / 3;
  const altered = await verify(Math.PI * (segment(2,7,8) + segment(16,8,9) + segment(2,9,7) - 20 * 3 ** 2));
  assert.equal(altered.project.sketches[0].constraints[0].value, "-8 mm");
  assert.deepEqual(pageErrors, []);
  console.log("PASS custom hollow turning dimensions, exact chamfered volumes, rejected edit, undo and reload; constrained rectangular profile, named width updates, extrusion and edge dimensions");
} finally { await browser.close(); }
