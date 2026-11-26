import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "three/examples/jsm/libs/fflate.module.js";
import { boxSketch, feature, geometry, near, runtime } from "../systems/runtime.mjs";
import { button, field, ready, saved } from "../projects/support.mjs";
import { appUrl, openBrowser } from "./browser.mjs";
import { barrelId, cappedPen, refillId } from "./fixtures/capped-pen.mjs";

// X-sections of these coaxial, cosmetic-thread fixtures are circles. Measure
// the actual walls, including the Parker pilot, independently of the size plan.
function sectionRings(section, shape, x) {
  const { paths } = section(shape, "X", x);
  return paths.map(path => {
    const radii = path.map(([y, z]) => Math.hypot(y, z));
    near(Math.max(...radii), Math.min(...radii), 1e-5, "Synthetic section remains circular");
    return radii[0];
  }).sort((a, b) => a - b);
}

function minimumRadialWall(section, shape) {
  const edges = shape.edges, points = new Set();
  try {
    for (const e of edges) {
      const start = e.startPoint, end = e.endPoint;
      try {
        points.add(Number(start.toTuple()[0].toFixed(6)));
        points.add(Number(end.toTuple()[0].toFixed(6)));
      } finally { start.delete(); end.delete(); }
    }
  } finally { edges.forEach(e => e.delete()); }
  const breaks = [...points].sort((a, b) => a - b);
  let wall = Infinity;
  for (let i = 1; i < breaks.length; i++) {
    const a = breaks[i - 1], b = breaks[i];
    if (b - a < 0.001) continue;
    for (const x of [a + 0.0001, b - 0.0001]) {
      const rings = sectionRings(section, shape, x);
      if (rings.length === 2) wall = Math.min(wall, rings[1] - rings[0]);
    }
  }
  assert(Number.isFinite(wall), "Hollow part has a measurable wall");
  return wall;
}

async function inspect(api, doc, fixture) {
  const { evaluateModel } = await api.load("buildModel");
  const { buildBodies, releaseBodies } = await api.load("geometry");
  const { cutDrawingSection } = await api.load("secondaryProjection");
  const { verifyCapPosting } = await api.load("capClearanceGeometry");
  const { features } = await evaluateModel(doc);
  const ids = features.filter(f => f.operation === "new").map(f => f.id);
  const bodies = buildBodies(features);
  try {
    verifyCapPosting(doc, fixture.capId, bodies, ids);
    const metrics = Object.fromEntries(bodies.map((b, i) => {
      const { bbox, volume, valid, solids } = geometry(b.shape);
      assert(valid && solids === 1, b.name + " is a single valid solid");
      return [ids[i], { name: b.name, volume, od: bbox[1][1] - bbox[0][1],
        wall: ids[i] === refillId ? 0 : minimumRadialWall(cutDrawingSection, b.shape) }];
    }));
    const barrel = bodies[ids.indexOf(barrelId)];
    const [radius] = sectionRings(cutDrawingSection, barrel.shape, 80);
    const majorCap = bodies[ids.indexOf(fixture.capId)].threadFrames.find(f => f.side === "internal").diameter;
    const onBarrel = barrel.threadFrames;
    const socket = onBarrel.find(f => f.side === "internal" && f.end === "end");
    const capThread = onBarrel.find(f => f.side === "external" && f.end === "end");
    const minor = capThread.diameter - 5 * Math.sqrt(3) * capThread.pitch / 8;
    return { parts: metrics, bore: 2 * radius, capRootWall: (metrics[fixture.capId].od - majorCap) / 2,
      nestedRootWall: (minor - socket.diameter) / 2 };
  } finally { releaseBodies(bodies); }
}

async function exportAndReadSteps(page, api, parts) {
  await button(page, "Export").click();
  await page.getByRole("button", { name: /CNC shop package/ }).click();
  const dialog = page.getByRole("dialog", { name: "CNC shop package" });
  const event = page.waitForEvent("download", { timeout: 120000 });
  await dialog.getByRole("button", { name: /Download ZIP \(3\)/ }).click();
  const file = await event;
  assert.equal(await file.failure(), null);
  const archive = unzipSync(await readFile(await file.path()));
  const keys = Object.keys(archive).filter(name => name.endsWith(".step"));
  assert.equal(keys.length, parts.length, "Each manufactured component gets one STEP");
  const { importSolidFile } = await api.load("exchangeSolids");
  const { releaseBodies } = await api.load("geometry");
  for (const part of parts) {
    const key = keys.find(name => name.endsWith("-" + part.name + ".step"));
    assert(key, part.name + " is present in the CNC export");
    const imported = await importSolidFile("step", new Blob([archive[key]]), part.name);
    try {
      assert.equal(imported.length, 1);
      const step = geometry(imported[0].shape);
      assert(step.valid && step.solids === 1);
      near(step.volume, part.volume, Math.max(1e-5, part.volume * 1e-6), part.name + " STEP volume");
      near(step.bbox[1][1] - step.bbox[0][1], part.od, 1e-5, part.name + " STEP OD");
    } finally { releaseBodies(imported); }
  }
}

const api = await runtime();
let browser;
try {
  const fixture = await cappedPen(api);
  const { insertRefill } = await api.load("refills");
  browser = await openBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  page.setDefaultTimeout(30000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const bench = page.getByRole("complementary", { name: "Pen design bench" });
  const slim = bench.getByRole("region", { name: "Slim pen" });
  const writing = bench.getByRole("region", { name: "Writing fit" });
  async function open(doc) {
    await field(page, "Open Turnmill project file").setInputFiles({
      name: "synthetic-slim-pen.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
    });
    await page.locator(".project-trigger").filter({ hasText: doc.name }).waitFor();
    await ready(page);
    if (!await bench.isVisible()) await button(page, "Pen Studio").click();
  }
  async function native() {
    await page.locator(".project-trigger").click();
    const next = page.waitForEvent("download");
    await page.getByRole("button", { name: /Save project file/ }).click();
    return JSON.parse(await readFile(await (await next).path(), "utf8"));
  }
  async function result(region, target) {
    const error = region.getByRole("alert");
    await Promise.race([target.waitFor({ timeout: 120000 }),
      error.waitFor({ timeout: 120000 }).then(async () => { throw Error(await error.innerText()); })]);
  }
  const read = async label => {
    const text = await slim.locator("dt").filter({ hasText: label }).locator("..").locator("dd").innerText();
    const match = text.match(/[\d.]+/);
    assert(match, label + " has a numeric readout");
    return Number(match[0]);
  };
  await page.goto(appUrl); await saved(page);
  for (const kind of ["energel-lr7", "parker-g2"]) {
    const doc = kind === "energel-lr7" ? fixture.document
      : { ...insertRefill(fixture.document, kind, {}, { replaceBodyId: refillId }).project, id: "slim-g2", name: "Capped Parker G2" };
    await open(doc);
    await button(writing, "Check writing fit").click();
    await result(writing, button(writing, "Apply writing fit"));
    await button(writing, "Apply writing fit").click();
    await writing.getByText("Writing fit verified", { exact: true }).waitFor();
    const before = await native(), initial = await inspect(api, before, fixture);
    const method = slim.getByRole("combobox", { name: "Sizing method", exact: true });
    const radial = kind === "parker-g2", floor = radial ? 1 : 0.35;
    await method.selectOption({ label: radial ? "Minimum wall" : "Diameter allowance" });
    const input = field(slim, radial ? "Minimum wall" : "Diameter allowance");
    const preview = button(slim, "Preview slimming"), apply = button(slim, "Apply slimmer pen");
    if (!radial) {
      await input.fill("0 mm");
      if (await preview.isEnabled()) await preview.click();
      await slim.getByRole("alert").filter({ hasText: /positive|greater than zero|above zero/i }).waitFor();
      assert(!(await apply.isVisible()) || await apply.isDisabled());
      assert.deepEqual(await native(), before, "Invalid allowance leaves the original work intact");
      await input.fill("5 mm + 0.75 mm");
      await preview.click(); await result(slim, apply);
      near(await read("Requested outside diameter"), initial.parts[refillId].od + 5.75, 0.001, "Custom diametral allowance");
      near(await read("Achievable outside diameter"), initial.parts[refillId].od + 5.75, 0.001, "Feasible custom OD is honored exactly");
    }
    await input.fill("1 mm"); await preview.click();
    await result(slim, apply);
    const widest = await read("Widest refill"), requested = await read("Requested outside diameter");
    const attainable = await read("Achievable outside diameter"), bore = await read("Barrel bore");
    near(widest, initial.parts[refillId].od, 0.001, "Widest installed refill includes its tail");
    near(bore, widest + 0.20, 0.001, "Barrel bore includes diametral running clearance");
    near(requested, radial ? bore + 2 * floor : widest + 1, 0.001, "Requested OD follows the chosen sizing rule");
    assert(attainable > requested && attainable < 20, "Nested threads limit this synthetic pen below the original Ø20 envelope");
    assert.deepEqual(await native(), before, "Preview makes no project changes");
    await apply.click(); await ready(page);
    const slimmer = await native();
    const after = await inspect(api, slimmer, fixture);
    near(after.bore, bore, 1e-4, "Machined barrel bore matches the preview");
    const made = [barrelId, fixture.coneId, fixture.capId].map(id => {
      const part = after.parts[id];
      assert(part.volume < initial.parts[id].volume, part.name + " loses material in the rebuilt solid");
      assert(part.wall >= floor - 0.001, part.name + " minimum measured radial wall " + part.wall + " ≥ " + floor);
      return part;
    });
    assert(after.capRootWall >= floor - 0.001, "Cap wall at the socket major diameter");
    assert(after.nestedRootWall >= floor - 0.001, "Wall between front male thread root and cone socket major diameter");
    near(Math.max(...made.map(p => p.od)), attainable, 0.001, "Largest outer surface matches the reported achievable OD");
    near(after.parts[barrelId].od, after.parts[fixture.capId].od, 1e-5, "Slim cap remains flush with the barrel");
    near(after.parts[refillId].volume, initial.parts[refillId].volume, 1e-7, "Catalog cartridge stays full size");
    await button(page, "Undo").click(); await ready(page);
    assert.deepEqual(await native(), before, "One Undo restores the original fitted assembly");
    await button(page, "Redo").click(); await ready(page);
    assert.deepEqual(await native(), slimmer, "Redo restores the slim pen");
    await saved(page); await page.reload(); await ready(page);
    if (!await bench.isVisible()) await button(page, "Pen Studio").click();
    assert.deepEqual(await native(), slimmer, "Saved slim native project survives reload");
    await button(writing, "Check writing fit").click();
    await result(writing, writing.getByText("Writing fit verified", { exact: true }));
    await button(writing, "Post cap for writing").click();
    await button(writing, "Cover writing tip").click();
    await exportAndReadSteps(page, api, made);
    if (!radial && process.env.QA_SLIM_PEN_SAMPLE) {
      const sample = { ...slimmer, id: "slim-capped-energel-example", name: "Slim capped EnerGel pen" };
      await writeFile(process.env.QA_SLIM_PEN_SAMPLE, JSON.stringify(sample, null, 2) + "\n");
    }
    console.log("PASS", kind, { widest, requested, attainable, bore, walls: made.map(p => [p.name, p.wall]),
      capRoot: after.capRootWall, nestedRoot: after.nestedRootWall, volumes: made.map(p => p.volume) });
  }
  const raw = { ...structuredClone(fixture.document), id: "one-step-slimming", name: "Unfitted capped pen" };
  raw.parameters.push({ name: "outer_diameter", label: "Barrel outside diameter", expression: "20 mm" },
    { name: "bore_diameter", label: "Barrel inside diameter", expression: "10 mm" });
  for (const point of raw.sketches.find(s => s.id === "section").points)
    point.y = point.y === "10" ? "outer_diameter / 2" : "bore_diameter / 2";
  await open(raw);
  const before = await native();
  assert.equal(before.workspaces.writingSetups, undefined);
  const preview = button(slim, "Preview slimming"), apply = button(slim, "Apply slimmer pen");
  await preview.click();
  await result(slim, apply);
  await slim.getByText(/also sets up the writing seat and rear support/).waitFor();
  assert.deepEqual(await native(), before, "Direct slim preview leaves the raw design intact");
  await apply.click(); await ready(page);
  await button(writing, "Check writing fit").click();
  await result(writing, writing.getByText("Writing fit verified", { exact: true }));
  assert.equal(await field(bench, "Barrel outside diameter").inputValue(), "10.7 mm");
  assert.equal(await field(bench, "Barrel inside diameter").inputValue(), "6.55 mm");
  const oneStep = await native();
  assert(oneStep.features.some(f => f.writingSeat) && oneStep.features.some(f => f.refillBacking));
  near((await inspect(api, oneStep, fixture)).parts[barrelId].od, 10.7, 1e-5, "One Apply fits the cartridge and slims the barrel");
  await button(page, "Undo").click(); await ready(page);
  assert.deepEqual(await native(), before, "One Undo restores all original parts and the free cartridge");

  // The loose block is outside the assembly. Its thickness is driven by the nose thread major.
  const witness = boxSketch("gauge-profile", 200, 0, 205, 4);
  const coupled = { ...raw, id: "pen-with-shared-dimension", name: "Pen and independent gauge",
    sketches: [...raw.sketches, witness], features: [...raw.features,
      { ...feature("gauge-block", witness.id, "cone_major"), name: "Loose gauge block" }] };
  await open(coupled);
  const withGauge = await native();
  await preview.click();
  await slim.getByRole("alert").filter({ hasText: /Loose gauge block.*shared parameter/i }).waitFor({ timeout: 120000 });
  assert(!(await apply.isVisible()) || await apply.isDisabled());
  assert.deepEqual(await native(), withGauge, "A dependent loose body blocks slimming without changing either solid");
  console.log("PASS direct writing-fit and slimming in one Undo, and unchanged project on unrelated shared-parameter rejection");
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await api.close();
}
