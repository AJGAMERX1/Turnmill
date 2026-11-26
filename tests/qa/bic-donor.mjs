import assert from "node:assert/strict";
import { appUrl, measure, openBrowser } from "./browser.mjs";
import { button, ready, saved } from "../projects/support.mjs";

// Known gauge for an independently measured synthetic donor. The front face of
// the gauge is the donor's seat. The open bore covers only the insertion shank.
const sleeve = {
  version:1, id:"donor-socket", name:"Donor socket", parameters:[],
  sketches:[{id:"socket-sketch", name:"Socket section", constraints:[],
    points:[[12,3.25],[12,5],[20,5],[20,3.25]].map(([x,y]) => ({x:String(x),y:String(y)}))}],
  features:[{id:"sleeve", name:"Test sleeve", sketchId:"socket-sketch", kind:"revolve",
    operation:"new", amount:"360 deg", suppressed:false}],
};
const browser = await openBrowser();
try {
  const page = await browser.newPage({viewport:{width:1250,height:880}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(appUrl);
  await saved(page);
  await page.getByLabel("Open Turnmill project file").setInputFiles({
    name:"donor.turnmill", mimeType:"application/json", buffer:Buffer.from(JSON.stringify(sleeve)),
  });
  await page.locator(".project-trigger").filter({hasText:sleeve.name}).waitFor();
  await ready(page);
  await button(page, "Pen Studio").click();
  const bench = page.getByRole("complementary", {name:"Pen design bench"});
  await button(bench, "Refill library").click();
  const dialog = page.getByRole("dialog", {name:"Refill library"});
  const family = dialog.getByLabel("Refill family", {exact:true});
  await family.selectOption("bic-round-stic");
  assert.match(await family.locator("option:checked").textContent(), /Round Stic/i);
  await dialog.locator(".refill-more summary").click();
  // Use the dialog's measurement fields, including unit input, as a maker would.
  const readings = [
    ["Tip to tail","130 mm"], ["Tube diameter","3 mm"], ["Metal tip diameter","2 mm"],
    ["Exposed metal tip length","4 mm"],
    ["Plastic nose front diameter","3 mm"], ["Stop collar diameter","7.5 mm"],
    ["Tip to seating face","12 mm"], ["Stop collar length","0.8 mm"],
    ["Press-in shank diameter","0.68 cm"], ["Press-in shank length","8 mm"],
  ];
  for (const [label,value] of readings) await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByRole("img", {name:/press-in shank.*seating face/i}).waitFor();
  await dialog.getByText("130 mm overall", {exact:true}).waitFor();
  await button(dialog,"Insert refill").click();
  await dialog.waitFor({state:"hidden"});
  await ready(page);
  const inserted = await measure(page);
  const donor = Object.values(inserted.project.workspaces.refills).find(r => r.kind === "bic-round-stic");
  assert(donor);
  assert.equal(inserted.bodies.length,2);
  const check = bench.getByRole("region", {name:"Diameter clearance"});
  await check.getByText(/0\.3 mm interference/i).first().waitFor();
  await check.getByText("Check a hole diameter", {exact:true}).click();
  const section = check.getByLabel("Refill diameter to check");
  assert.match(await section.locator("option:checked").textContent(), /shank/i);
  const hole = check.getByLabel("Hole diameter");
  await hole.fill("6.5 mm"); await hole.press("Enter");
  const results = check.locator(".diameter-result").filter({hasText:/Entered hole/});
  await results.getByText(/0\.3 mm interference/i).waitFor();
  await section.selectOption("body_diameter");
  await results.getByText(/3\.5 mm clearance/i).waitFor();
  await saved(page);
  await page.reload(); await ready(page);
  await button(page,"Pen Studio").click();
  await check.getByText(/0\.3 mm interference/i).first().waitFor();
  await check.getByText("Check a hole diameter", {exact:true}).click();
  assert.equal(await section.inputValue(),"body_diameter");
  assert.equal(await hole.inputValue(),"6.5 mm");
  assert.equal((await measure(page)).project.workspaces.refills[donor.bodyId].kind, "bic-round-stic");
  await button(page,"New pen").click();
  await page.getByRole("dialog").getByRole("button",{name:/Bolt-action pen/}).click();
  await ready(page);
  await button(page,"Refills").click();
  await family.selectOption("bic-cristal-original");
  assert(await button(dialog,"Replace refill").isDisabled(), "fixed donor cannot take the moving refill's place");
  await button(dialog,"Add as a separate part").click();
  await button(dialog,"Insert refill").click();
  await dialog.waitFor({state:"hidden"}); await ready(page);
  const bolt = await measure(page);
  assert.equal(bolt.project.workspaces.refills["bolt-refill"].kind,"parker-g2");
  assert.equal(bolt.project.workspaces.joints["bolt-refill"].parent,"bolt-carrier");
  assert(Object.values(bolt.project.workspaces.refills).some(r => r.kind === "bic-cristal-original"));
  assert.deepEqual(errors,[]);
  console.log("PASS measured Round Stic insertion, automatic socket fit, manual shank vs tube, saved project and fixed donor beside an intact bolt mechanism.");
} finally { await browser.close(); }
