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
  const multi = structuredClone(base);
  multi.id = "inspector-mixed-parts";
  multi.name = "Grip and refills";
  multi.features[0].name = "Grip cone";
  multi.emptyParts = [{ id: "empty-part", name: "Empty part" }];
  multi.parameters = [{ name: "grip_end", label: "Grip end station", expression: "20 mm" }];
  multi.sketches[0].points[4].x = "grip_end";
  multi.sketches[0].points[5].x = "grip_end";
  await open(multi);
  const inspector = p.locator(".inspector");
  const refillDialog = p.getByRole("dialog", {name: "Refill library"});
  for (const kind of ["parker-g2", "bic-round-stic"]) {
    await button(p, "Refills").click();
    await field(refillDialog, "Refill family").selectOption(kind);
    await button(refillDialog, "Insert refill").click();
    await refillDialog.waitFor({state: "hidden"});
    await ready(p);
  }
  const assembled = await measure(p);
  const refills = Object.values(assembled.project.workspaces.refills);
  const parker = refills.find(r => r.kind === "parker-g2");
  const bic = refills.find(r => r.kind === "bic-round-stic");
  assert(parker && bic && parker.prefix !== bic.prefix);

  await p.getByRole("tab", { name: "BIC Round Stic donor", exact: true }).click();
  assert.equal(await field(inspector, "Tip to tail").inputValue(), "132 mm");
  assert.equal(await field(inspector, "Press-in shank diameter").inputValue(), "4 mm");
  assert.doesNotMatch(await inspector.innerText(), /Parker|Grip end station/i);
  await inspector.getByText(/^More dimensions/).click();
  assert.equal(await field(inspector, "Stop collar diameter").inputValue(), "5.5 mm");
  assert.equal(await field(inspector, "Reservoir taper length").count(), 0, "catalog exposes the complete donor’s actual dimensions");
  await field(inspector, "Tip to tail").fill("13.4 cm");
  await field(inspector, "Tip to tail").press("Enter");
  await p.waitForFunction(async ({key}) => {
    const state = await window.__cadTest.snapshot().catch(() => null);
    return state && !state.busy && state.values[key] === 134;
  }, {key: bic.prefix + "_length"}, {timeout: 30000});
  const changed = await measure(p);
  assert.deepEqual(changed.project.parameters.filter(param => param.name !== bic.prefix + "_length"),
    assembled.project.parameters.filter(param => param.name !== bic.prefix + "_length"));
  const bicIndex = changed.project.features.filter(f => f.operation === "new").findIndex(f => f.id === bic.bodyId);
  near(changed.bodies[bicIndex].bbox[1][0], 134);

  await p.getByRole("tab", {name: "Parker-style G2", exact: true}).click();
  assert.equal(await field(inspector, "Tip to tail").inputValue(), "98.1 mm");
  assert.equal(await field(inspector, "Press-in shank diameter").count(), 0);
  await p.getByRole("tab", {name: "All parts", exact: true}).click();
  await p.locator(".tree-item").filter({has: p.getByText("Grip cone", {exact: true})}).click();
  assert.equal(await field(inspector, "Grip end station").inputValue(), "20 mm");
  assert.equal(await field(inspector, "Tip to tail").count(), 0);
  assert.doesNotMatch(await inspector.innerText(), /Parker-style|Round Stic/);

  await p.getByRole("tab", {name: "Empty part", exact: true}).click();
  assert.equal(await inspector.locator(".dim-field").count(), 0, "empty parts own no dimensions");
  await button(inspector, "All parameters").click();
  const allParams = p.getByRole("dialog", {name: "Named parameters"});
  assert.equal(await field(allParams, "Expression for " + bic.prefix + "_length").inputValue(), "13.4 cm");
  assert.equal(await field(allParams, "Expression for " + parker.prefix + "_length").inputValue(), "98.1 mm");
  assert.equal(await field(allParams, "Expression for grip_end").inputValue(), "20 mm");
  await button(allParams, "Cancel").click();
  const nose = structuredClone(base);
  nose.id = "independent-cone-diameters";
  nose.name = "Hollow nose and barrel";
  nose.sketches[0].points = [[0,3],[0,7],[40,4],[40,3]].map(([x,y]) => ({x:String(x),y:String(y)}));
  const ring = {id:"ring",name:"Grip ring",kind:"grip",style:"rings",end:"start",
    offset:"4 mm",length:"6 mm",depth:"0.15 mm",width:"0.7 mm",count:"1"};
  Object.assign(nose.features[0], {name:"Tapered nose", finishes:[ring]});
  nose.sketches.push({id:"neighbor-profile",name:"Barrel profile",constraints:[],
    points:[[45,3],[45,8],[65,8],[65,3]].map(([x,y]) => ({x:String(x),y:String(y)}))});
  nose.features.push({...base.features[0], id:"barrel", name:"Neighbor barrel", sketchId:"neighbor-profile"});
  await open(nose);
  await p.getByRole("tab", {name:"Tapered nose", exact:true}).click();
  const neighboringBody = (await measure(p)).bodies[1];
  function milledConeVolume(baseDiameter, tipDiameter) {
    const r1 = baseDiameter / 2, r2 = tipDiameter / 2;
    const rAtRing = r1 + (r2 - r1) * 7 / 40;
    return Math.PI * (segment(40, r1, r2) - 40 * 3 ** 2 -
      .7 * (2 * rAtRing * .15 - .15 ** 2));
  }
  async function checkCone(baseDiameter, tipDiameter) {
    const expected = milledConeVolume(baseDiameter, tipDiameter);
    await p.waitForFunction(async (volume) => {
      const snap = await window.__cadTest.snapshot().catch(() => null);
      return snap && !snap.busy && !snap.error && Math.abs(snap.bodies[0]?.volume - volume) < 0.0001;
    }, expected, {timeout:30000});
    const state = await measure(p);
    assert.equal(state.bodies[0].solids, 1);
    assert(state.bodies[0].valid);
    near(state.bodies[0].bbox[1][0], 40);
    near(state.bodies[0].bbox[1][1], Math.max(baseDiameter, tipDiameter) / 2);
    assert.equal(state.bodies[1].volume, neighboringBody.volume);
    assert.deepEqual(state.bodies[1].bbox, neighboringBody.bbox);
    assert.deepEqual(state.project.features[0].finishes, [ring]);
  }
  await checkCone(14,8);
  await edit("Tip outside diameter", "5 mm");
  await p.getByRole("alert").filter({hasText:/adjoining diameter|bore/i}).waitFor();
  await checkCone(14,8);
  // A 6.01 mm base clears the 6 mm bore but leaves too little stock for the grip cut.
  await edit("Base outside diameter", "6.01 mm");
  await p.getByRole("alert").filter({hasText:/grooves reach a bore/i}).waitFor();
  await checkCone(14,8);
  await edit("Tip outside diameter", "14 mm");
  await checkCone(14,14);
  await edit("Tip outside diameter", "16 mm");
  await checkCone(14,16);
  assert.equal(await field(inspector, "Base outside diameter").inputValue(), "14 mm");
  assert.equal(await field(inspector, "Tip outside diameter").inputValue(), "16 mm");
  await edit("Tip outside diameter","0.9 cm");
  await checkCone(14,9);
  await edit("Base outside diameter","16 mm");
  await checkCone(16,9);
  await button(p,"Undo").click();
  await checkCone(14,9);

  // At a knife edge, one sketch point belongs to both the outside taper and the bore.
  const sharp = structuredClone(nose);
  sharp.id = "cone-with-shared-rim";
  sharp.sketches[0].points = [[0,3],[0,7],[40,3]].map(([x,y]) => ({x:String(x),y:String(y)}));
  await open(sharp);
  await p.getByRole("tab", {name:"Tapered nose", exact:true}).click();
  await checkCone(14,6);
  await edit("Tip outside diameter","9 mm");
  await checkCone(14,9);
  assert.equal((await measure(p)).project.sketches[0].points.length, 4);
  await button(p,"Undo").click();
  await checkCone(14,6);
  assert.equal((await measure(p)).project.sketches[0].points.length, 3);

  const together = structuredClone(nose);
  together.id = "merged-cone-and-barrel";
  together.sketches[1].points.forEach(point => { point.x = String(Number(point.x) - 65); });
  await open(together);
  await button(p, "Merge parts").click();
  const merge = p.getByRole("dialog", {name:"Merge parts", exact:true});
  await field(merge, "Keep part").selectOption("barrel");
  await field(merge, "Part to merge").selectOption("body");
  await button(merge, "Merge parts").click();
  await merge.waitFor({state:"hidden"});
  await ready(p);
  await p.getByRole("tab", {name:"Neighbor barrel", exact:true}).click();
  await button(inspector, "Inspect Tapered nose profile").click();
  await edit("Tip outside diameter", "10 mm");
  const barrelVolume = Math.PI * 20 * (8 ** 2 - 3 ** 2);
  const combined = await verify(barrelVolume + milledConeVolume(14,10));
  assert.equal(combined.bodies[0].solids, 1);
  const kept = combined.project.sketches.find(sketch => sketch.id === "neighbor-profile");
  assert.deepEqual(kept.points, together.sketches[1].points, "editing the absorbed cone keeps barrel coordinates");
  assert.deepEqual(pageErrors, []);
  console.log("PASS custom hollow turning dimensions, exact chamfered volumes, rejected edit, undo and reload; constrained rectangular profile, named width updates, extrusion and edge dimensions; scoped part, refill and empty-tab inspection; independent hollow-cone diameters on milled stock.");
} finally { await browser.close(); }
