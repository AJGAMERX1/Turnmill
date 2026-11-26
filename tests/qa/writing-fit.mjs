import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { makeBox, measureVolume } from "replicad";
import { Matrix4, Vector3 } from "three";
import { near, runtime } from "../systems/runtime.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";
import { appUrl, openBrowser } from "./browser.mjs";
import { barrelId, cappedPen, refillId } from "./fixtures/capped-pen.mjs";

async function measureWritingFit(api, document, fixture, projection, endplay = 0) {
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { bodyIds, buildPoses } = await api.load("kinematics");
  const { resolveThreadMates } = await api.load("threadMates");
  const { positioned } = await api.load("motionGeometry");
  const { solidBounds } = await api.load("secondaryProjection");
  const { verifyCapPosting } = await api.load("capClearanceGeometry");
  const { features, values } = await evaluateModel(document);
  const bodies = buildBodies(features), ids = bodyIds(features);
  const located = [];
  try {
    const joints = resolveThreadMates(document.workspaces.joints, bodies.flatMap(b => b.threadFrames ?? []), values, ids);
    const matrices = buildPoses(ids, joints, document.workspaces.jointPose ?? {}, values);
    for (const [i, body] of bodies.entries()) located.push(positioned(body.shape, matrices[i]));
    const index = id => {
      assert(ids.includes(id), "Expected solid " + id);
      return ids.indexOf(id);
    };
    const cartridge = located[index(refillId)], cone = located[index(fixture.coneId)];
    const point = new Vector3(0, 0, 0).applyMatrix4(new Matrix4().fromArray(matrices[index(refillId)]));
    near(point.x - solidBounds(cone)[1][0], projection, 1e-5, "Assembled writing point projects beyond the cone rim");
    near(solidBounds(cartridge)[1][0], point.x, 1e-5, "Actual LR7 solid faces the writing end");
    near(Math.hypot(point.y, point.z), 0, 1e-6, "Writing point lies on the barrel axis");
    const tail = solidBounds(cartridge)[0][0];
    const parker = document.workspaces.refills[refillId].kind === "parker-g2";
    near(point.x - tail, parker ? 98.1 : 111, 1e-5, "Assembled catalog cartridge length");
    if (parker) {
      const barrel = located[index(barrelId)];
      // The cosmetic threads occupy the same stock within their engaged band.
      // Isolate the new pilot behind the 3 mm tenon to check its clearance.
      const rearOfPilot = solidBounds(cone)[0][0], tenonEnd = 127 - 3;
      near(rearOfPilot, point.x - 23.2, 1e-5, "Pilot lands on the deeper G2 reservoir shoulder");
      const witness = makeBox([rearOfPilot - 1, -12, -12], [tenonEnd - 0.001, 12, 12]);
      try {
        const pilot = cone.intersect(witness);
        try {
          assert(measureVolume(pilot) > 1, "The cone contains a real pilot extension");
          const common = barrel.intersect(pilot);
          try { near(Math.abs(measureVolume(common)), 0, 1e-6, "The pilot clears the barrel cavity"); }
          finally { common.delete(); }
        } finally { pilot.delete(); }
      } finally { witness.delete(); }
    }
    const overlap = (a, b) => {
      const common = a.intersect(b);
      try { return Math.abs(measureVolume(common)); } finally { common.delete(); }
    };
    for (const [i, shape] of located.entries()) {
      if (ids[i] !== refillId) near(overlap(cartridge, shape), 0, 1e-6, "Refill clears " + bodies[i].name);
    }
    // Pushing by 0.05 mm in either direction must encounter solid material.
    // A fixed joint on its own would allow both of these physical probes to pass.
    const shove = dx => positioned(cartridge, new Matrix4().makeTranslation(dx, 0, 0).toArray());
    const forward = shove(0.05), backward = shove(-endplay - 0.05);
    try {
      assert(overlap(cone, forward) > 0.001, "The cone shoulder physically stops the refill at the writing end");
      const backstops = located.filter((_, i) => ![refillId, fixture.capId, fixture.coneId].includes(ids[i]));
      assert(backstops.some(s => overlap(s, backward) > 0.001), "The body physically backs the refill tail");
      if (endplay > 0) {
        const withinGap = shove(-endplay);
        try {
          backstops.forEach(s => near(overlap(s, withinGap), 0, 1e-6, "Requested rear endplay remains free"));
        } finally { withinGap.delete(); }
      }
    } finally { forward.delete(); backward.delete(); }
    verifyCapPosting(document, fixture.capId, bodies, ids);
    console.log("Measured writing point X", point.x, "mm; tail X", tail, "mm; both contact probes and both cap positions passed");
  } finally {
    located.forEach(shape => shape.delete());
    releaseBodies(bodies);
  }
}

const api = await runtime();
let browser;
try {
  const fixture = await cappedPen(api);
  browser = await openBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 930 }, acceptDownloads: true });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const bench = page.getByRole("complementary", { name: "Pen design bench" });
  const fitPanel = bench.getByRole("region", { name: "Writing fit" });
  const check = button(fitPanel, "Check writing fit"), apply = button(fitPanel, "Apply writing fit");
  const verified = fitPanel.getByText("Writing fit verified", { exact: true });
  const reading = label => fitPanel.locator("dt").filter({ hasText: label }).locator("..").locator("dd").innerText();
  async function showFit() {
    if (!(await bench.isVisible())) await button(page, "Pen Studio").click();
    await bench.getByRole("heading", { name: "Writing fit", exact: true }).waitFor();
  }
  async function open(doc) {
    await field(page, "Open Turnmill project file").setInputFiles({
      name: "synthetic-pen.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
    });
    await page.locator(".project-trigger").filter({ hasText: doc.name }).waitFor();
    await ready(page);
    await showFit();
  }
  async function saveNative() {
    await page.locator(".project-trigger").click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: /Save project file/ }).click();
    const file = await pending;
    assert.equal(await file.failure(), null);
    return JSON.parse(await readFile(await file.path(), "utf8"));
  }

  await page.goto(appUrl);
  await saved(page);
  await open(fixture.document);
  const before = await saveNative();
  assert.equal(await field(bench, "Tip projection").inputValue(), "1.5 mm");
  await check.click();
  await Promise.race([
    apply.waitFor({ timeout: 180000 }),
    fitPanel.getByRole("alert").waitFor({ timeout: 180000 }).then(async () => { throw Error(await fitPanel.getByRole("alert").innerText()); }),
  ]);
  await fitPanel.getByText(/points away from the writing end/).waitFor();
  assert.equal(await reading("Tip beyond cone"), "1.5 mm");
  assert.equal(await reading("Guide bore"), "Ø2.37 mm");
  assert.equal(await reading("Rear endplay"), "0 mm");
  assert.equal(await reading("Cap clearance"), "Front and posted");
  assert.deepEqual(await saveNative(), before, "Checking the fit leaves the project untouched");
  await apply.click();
  await ready(page);
  await verified.waitFor();
  const fitted = await saveNative();
  assert.notDeepEqual(fitted.features, before.features, "Apply makes a geometric edit");
  if (process.env.QA_WRITING_FIT_SAMPLE) {
    await writeFile(process.env.QA_WRITING_FIT_SAMPLE, JSON.stringify(fitted, null, 2) + "\n");
  }
  await measureWritingFit(api, fitted, fixture, 1.5);
  await button(page, "Undo").click();
  await ready(page);
  assert.deepEqual(await saveNative(), before, "One Undo restores the initial document");
  await button(page, "Redo").click();
  await ready(page);
  assert.deepEqual(await saveNative(), fitted, "Redo restores the checked, fitted pen");
  await saved(page);
  await page.reload();
  await saved(page);
  await ready(page);
  await showFit();
  assert.deepEqual(await saveNative(), fitted, "Reload recovers both seats, the fitted refill and cap");

  async function blocked(doc, reason) {
    await open(doc);
    const prior = await saveNative();
    await check.click();
    await bench.getByRole("alert").filter({ hasText: reason }).waitFor({ timeout: 180000 });
    assert(!(await apply.isVisible()) || await apply.isDisabled(), "Blocked fit has no available Apply action");
    assert.deepEqual(await saveNative(), prior, "Rejected fit left " + doc.name + " untouched");
  }
  const short = await cappedPen(api, 65);
  await blocked(short.document, /lengthen the barrel/i);

  const thin = structuredClone(fixture.document);
  thin.id = "thin-cone-wall";
  thin.name = "Thin cone with no guide allowance";
  thin.parameters.find(p => p.name === "cone_tip").expression = "2.29 mm";
  await blocked(thin, /outside diameter.*wall/i);

  const shallowCap = structuredClone(fixture.document);
  shallowCap.id = "cap-roof-collision";
  shallowCap.name = "Cap clears cone but hits writing tip";
  shallowCap.parameters.find(p => p.name === "cap_length").expression = "19.75 mm";
  await blocked(shallowCap, /more room inside.*cap|deepen its pocket/i);

  await open(fitted);
  assert.deepEqual(await saveNative(), fitted, "The original fitted native file reopens after another project");
  await check.click();
  await verified.waitFor();
  assert.deepEqual(await saveNative(), fitted, "Rechecking an existing fit does not change it");
  await field(bench, "Tip projection").fill("2 mm");
  await fitPanel.getByText("Fit allowances", { exact: true }).click();
  await field(bench, "Rear endplay").fill("0.25 mm");
  await check.click();
  await apply.click({ timeout: 180000 });
  await ready(page);
  const refitted = await saveNative();
  assert.equal(refitted.features.length, fitted.features.length, "The revised fit replaces its original cuts and stop");
  await measureWritingFit(api, refitted, fixture, 2, 0.25);
  await button(fitPanel, "Post cap for writing").click();
  const posted = await saveNative();
  assert.equal(posted.workspaces.capMounts[fixture.capId].active, "start");
  assert.deepEqual(posted.workspaces.joints[refillId], refitted.workspaces.joints[refillId]);
  await button(fitPanel, "Cover writing tip").click();
  assert.equal((await saveNative()).workspaces.capMounts[fixture.capId].active, "end");
  await button(bench, "Refill library").click();
  const library = page.getByRole("dialog", { name: "Refill library" });
  await field(library, "Refill placement").selectOption(refillId);
  await field(library, "Refill family").selectOption("parker-g2");
  await button(library, "Replace refill").click();
  await library.waitFor({ state: "hidden" });
  await showFit();
  await field(bench, "Tip projection").fill("1.5 mm");
  if (!await field(bench, "Rear endplay").isVisible()) await fitPanel.getByText("Fit allowances", { exact: true }).click();
  await field(bench, "Rear endplay").fill("0 mm");
  await check.click();
  await fitPanel.getByText(/Extend the cone seat 3.7 mm/).waitFor();
  await apply.click();
  await verified.waitFor();
  await ready(page);
  const parker = await saveNative();
  assert.equal(parker.workspaces.refills[refillId].kind, "parker-g2");
  await measureWritingFit(api, parker, fixture, 1.5);
  await open(short.document);
  await open(parker);
  await check.click();
  await verified.waitFor();
  assert.deepEqual(await saveNative(), parker, "Reopened Parker pilot and its backing rebuild and verify");
  // The refill neck fits this Ø3.4 mm internal ring, but the extended Ø3.64 mm pilot does not.
  const { insertRefill } = await api.load("refills");
  const tight = insertRefill(structuredClone(fixture.document), "parker-g2", {}, { replaceBodyId: refillId }).project;
  tight.id = "pilot-barrel-shoulder-interference";
  tight.name = "Barrel shoulder in the Parker pilot";
  const barrelSection = tight.sketches.find(s => s.id === "section").points;
  // Supply an existing rear stop at X45.4 so this test isolates the nose collision.
  barrelSection[0].y = "1.5";
  barrelSection.splice(1, 0,
    ...[[45.4,1.5],[45.4,5],[121.3,5],[121.3,1.7],[122.8,1.7],[122.8,5]].map(([x, y]) => ({ x: String(x), y: String(y) })));
  await blocked(tight, /extension|pilot/i);
  assert.deepEqual(errors, []);
  console.log("PASS capped LR7 and Parker G2 writing fit, measured retention and endplay, two cap mounts, undo/redo and native reopen." +
    " Rejected short barrel, thin tip, shallow cap and obstructed pilot.");
} finally {
  await browser?.close();
  await api.close();
}
