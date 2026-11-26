import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { appUrl, openBrowser, measure } from "./browser.mjs";
import { button, download, ready, saved } from "../projects/support.mjs";

async function waitForModel(page, matches) {
  const deadline = Date.now() + 30000;
  do {
    const state = await measure(page);
    if (matches(state)) return state;
    await delay(80);
  } while (Date.now() < deadline);
  throw Error("Timed out waiting for the expected saved project or joint pose");
}

const dir = process.env.QA_PEN_STUDIO_OUT || "test-evidence/runner/pen-studio";
await mkdir(dir, { recursive: true });
const browser = await openBrowser();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.setDefaultTimeout(30000);
  await p.goto(appUrl); await ready(p);
  assert.equal(await button(p, "Scales").count(), 0);
  await button(p, "Pen Studio").click(); await button(p, "New pen").click();
  await p.getByRole("dialog").getByRole("button", {name: /Bolt-action pen/}).click();
  await button(p, "Writing").click();
  await p.locator(".bolt-action-card strong").filter({ hasText: /^Writing$/ }).waitFor();
  const writing = await waitForModel(p, s => s.project.workspaces?.jointPose?.["bolt-carrier"]?.[0] > 0);
  const i = writing.joints.ids.indexOf("bolt-refill");
  assert(Math.abs(writing.joints.matrices[i][12] + 2.3) < 1e-6);
  await button(p, "Pen Studio").click();
  const bench = p.getByRole("complementary", {name: "Pen design bench"});
  await bench.getByText("0.12 mm", {exact: true}).waitFor();
  const mass = () => bench.locator("dt", {hasText: "Modeled mass"}).locator("..").locator("dd").innerText();
  const initialMass = parseFloat(await mass());
  await button(bench,"Brass barrel").click();
  assert(parseFloat(await mass()) > initialMass, "material selection updates the solid mass");
  await button(bench,"Titanium barrel").click();
  await p.screenshot({path: join(dir, "writing.png")});
  await download(p, () => button(p, "Save PNG").click(), join(dir, "render.png"));
  const image = await readFile(join(dir, "render.png"));
  assert.equal(image.toString("ascii", 1, 4), "PNG");
  assert.equal(Math.max(image.readUInt32BE(16), image.readUInt32BE(20)), 1920);
  assert(image.length > 30000, "render includes modeled surfaces");
  await p.getByLabel("Reveal internals").check();
  await download(p, () => button(p, "Save PNG").click(), join(dir, "internal.png"));
  assert(!(await readFile(join(dir,"internal.png")).then(b => b.equals(image))), "revealing mechanism changes geometry appearance");
  await button(p, "Refill library").click();
  await p.getByLabel("Refill family").selectOption("energel-lr7");
  await button(p,"Replace refill").click();
  await bench.getByText("Pentel EnerGel LR7", {exact: true}).waitFor();
  await ready(p);
  const swapped = await measure(p);
  assert.equal(swapped.values.refill_length,111);
  assert.equal(swapped.project.workspaces.joints["bolt-refill"].parent,"bolt-carrier");
  assert.equal(swapped.bodies.length,writing.bodies.length);
  const reverse = bench.getByRole("button", { name: /Reverse.*EnerGel/i });
  const original = swapped.bodies[i];
  async function checkRefillCenter(x) {
    await ready(p);
    const current = await measure(p);
    const body = current.bodies[i];
    assert(Math.abs(body.center[0] - x) < 1e-6, "the writing end moved on the actual refill solid");
    assert(Math.abs(body.volume - original.volume) < 1e-6, "turning the refill preserves volume");
    body.bbox.forEach((corner, side) => corner.forEach((n, axis) =>
      assert(Math.abs(n - original.bbox[side][axis]) < 1e-6, "reversal keeps the occupied bounds")));
    assert.deepEqual(current.project.workspaces.joints, swapped.project.workspaces.joints);
    assert.deepEqual(current.project.workspaces.jointPose, swapped.project.workspaces.jointPose);
  }
  const reversedX = swapped.values.refill_length - original.center[0];
  assert(Math.abs(reversedX - original.center[0]) > 1);
  await reverse.click();
  await checkRefillCenter(reversedX);
  await button(p, "Undo").click();
  await checkRefillCenter(original.center[0]);
  await button(p, "Redo").click();
  await checkRefillCenter(reversedX);
  await saved(p);
  await p.reload(); await ready(p);
  await button(p,"Pen Studio").click();
  await checkRefillCenter(reversedX);
  await reverse.click();
  await checkRefillCenter(original.center[0]);
  const grip = p.getByLabel("Grip station");
  await grip.fill("1/2 in"); await grip.press("Enter");
  assert.equal((await measure(p)).project.workspaces.gripStation,"1/2 in");
  await button(p,"Open assembly").click(); await button(p,"Pocket").click();
  await p.locator(".bolt-action-card strong").filter({ hasText:/^Pocket$/ }).waitFor();
  const pocket = await waitForModel(p, s => s.project.workspaces?.jointPose?.["bolt-carrier"]?.[0] === 0);
  assert(Math.abs(pocket.joints.matrices[i][12] - 0.8) < 1e-6);
  await p.reload(); await ready(p);
  await button(p,"Pen Studio").click();
  assert.equal(await p.getByLabel("Grip station").inputValue(),"1/2 in");
  await bench.getByText("Pentel EnerGel LR7", {exact:true}).waitFor();
  await p.setViewportSize({width:390,height:844});
  await p.screenshot({path:join(dir,"mobile.png")});
  assert(await button(p,"Save PNG").isVisible());
  // A native turned sleeve overlaps the straight part of an LR7 reservoir. Its bore is
  // part geometry; this check must appear immediately without filling a comparison field.
  const refillBody = swapped.project.features.find(f => f.id === "bolt-refill");
  const refillSketch = swapped.project.sketches.find(sketch => sketch.id === refillBody.sketchId);
  const fixture = {
    version: 1, id: "sleeve-with-refill", name: "Sleeve with refill",
    parameters: [
      ...swapped.project.parameters.filter(v => v.name.startsWith("refill_")).map(v =>
        v.name === "refill_body_diameter" ? { ...v, expression: "6 mm" } : v),
      { name: "bore_diameter", label: "Sleeve bore", expression: "5 mm" },
    ],
    sketches: [{
      id: "sleeve-profile", name: "Sleeve section", constraints: [],
      points: [["40","bore_diameter/2"], ["70","bore_diameter/2"], ["70","5"], ["40","5"]]
        .map(([x,y]) => ({x,y})),
    }, refillSketch],
    features: [{
      id: "sleeve", name: "Sleeve", kind: "revolve", sketchId: "sleeve-profile",
      amount: "360 deg", operation: "new", suppressed: false,
    }, refillBody],
    workspaces: { refills: swapped.project.workspaces.refills },
  };
  await p.getByLabel("Open Turnmill project file").setInputFiles({
    name: "sleeve.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await waitForModel(p, s => s.project.id === fixture.id);
  await ready(p); await button(p, "Pen Studio").click();
  await bench.getByText(/1 mm interference/i).first().waitFor();
  const sleeveBore = bench.getByLabel("Sleeve bore");
  await sleeveBore.fill("6.5 mm"); await sleeveBore.press("Enter");
  await bench.getByText(/0.5 mm clearance/i).first().waitFor();
  assert.equal(await bench.getByText(/1 mm interference/i).count(), 0);

  await bench.getByText("Check a hole diameter", {exact:true}).click();
  const manual = bench.getByRole("region", {name:"Diameter clearance"});
  const hole = manual.getByLabel("Hole diameter");
  async function checkHole(diameter, result) {
    await hole.fill(diameter); await hole.press("Enter");
    await manual.getByText(result).first().waitFor();
  }
  await checkHole("5 mm", /1 mm interference/i);
  await checkHole("6 mm", /line.to.line.*0 mm clearance/i);
  await checkHole("5.9 mm", /0.1 mm interference/i);
  await button(bench, "Refill library").click();
  await p.getByLabel("Refill placement").selectOption(refillBody.id);
  await p.getByLabel("Refill family").selectOption("parker-g2");
  const previewReverse = button(p.getByRole("dialog"), "Reverse refill");
  await previewReverse.click();
  assert.equal(await previewReverse.getAttribute("aria-pressed"), "true");
  await button(p, "Replace refill").click(); await ready(p);
  await manual.getByText(/0.1 mm clearance/i).first().waitFor();
  assert.equal(await manual.getByText(/interference/i).count(), 0);
  assert.equal((await measure(p)).project.workspaces.refills[refillBody.id].reversed, true);
  assert.deepEqual(errors,[]);
  console.log("PASS bolt endpoints, refill exchange, persisted end-for-end reversal and undo/redo, tip guide clearance, saved grip station, product and internal PNGs, mobile, reopened design and automatic and manual refill diameter checks.");
} finally { await browser.close(); }
