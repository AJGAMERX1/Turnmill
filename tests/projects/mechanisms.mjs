import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  button,
  field,
  input,
  newProject,
  sample,
  native,
  ready,
  profile,
  feature,
  operation,
  stepExport,
  jointReport,
} from "./support.mjs";

async function body(p, name, kind, points, amount, op = "new") {
  await profile(p, points, points.length === 2 ? "rectangle" : "polygon");
  await feature(p, kind, name, amount, op);
}
async function joint(p, component, type, axis, min, max) {
  await field(p, "Component").selectOption({ label: component });
  await field(p, "Joint").selectOption(type);
  await field(p, "Axis").selectOption(axis);
  await input(p, "Lower limit", min);
  await input(p, "Upper limit", max);
}
export async function hinge(s) {
  const p = s.page;
  await newProject(p, /Blank part/);
  for (const [index, [x, end, near, far]] of [
    [0, 8, -2, -12],
    [9, 17, 2, 12],
  ].entries()) {
    const name = index ? "Moving leaf" : "Fixed leaf";
    await body(
      p,
      name,
      "Revolve",
      [
        [x, 1.7],
        [end, 2.5],
      ],
      "360 deg",
    );
    await body(
      p,
      name + " web",
      "Extrude",
      [
        [x, near],
        [end, far],
      ],
      "1 mm",
      "add",
    );
    await sample(s, index ? "02-moving-leaf" : "01-fixed-leaf");
  }
  await body(
    p,
    "Hinge pin",
    "Revolve",
    [
      [0, 0],
      [17, 1.5],
    ],
    "360 deg",
  );
  const solids = await sample(s, "03-pin");
  assert.equal(solids.bodies.length, 3);
  assert(
    Math.abs(
      solids.bodies.find((b) => b.name === "Hinge pin").volume -
        Math.PI * 1.5 ** 2 * 17,
    ) < 0.001,
  );
  await button(p, "Assembly").click();
  await joint(p, "Moving leaf", "revolute", "X", "0 deg", "180 deg");
  const measurements = [];
  for (const [request, expected] of [
    [-5, 0],
    [90, 90],
    [181, 180],
    [0, 0],
  ]) {
    await input(p, "Drive value", request + " deg");
    await p.waitForFunction(
      (exp) =>
        Number(
          document.querySelector('input[aria-label="Drive value"]').value,
        ) === exp,
      expected,
    );
    measurements.push({
      request,
      actual: Number(await field(p, "Drive value").inputValue()),
    });
    await sample(s, "04-rotation-" + expected + "-requested-" + request);
  }
  await field(p, "Compare with").selectOption("__all__");
  await p
    .locator("summary")
    .filter({ hasText: "Full-travel resolution" })
    .click();
  await field(p, "Maximum poses per pair").selectOption("513");
  await input(p, "Required clearance", "0.1 mm");
  const report = await jointReport(p, "Full travel");
  await writeFile(
    join(s.dir, "sweep.json"),
    JSON.stringify({ measurements, report }, null, 2),
  );
  await sample(s, "05-clearance");
  assert(
    report.split("\n").every((row) => /clear throughout/i.test(row)),
    report,
  );
  await native(s, "hinge");
  await button(p, "Part").click();
  await ready(p);
  await stepExport(s, "hinge");
}
export async function clickPen(s) {
  const p = s.page;
  await newProject(p, /Blank part/);
  await body(
    p,
    "Guide tube",
    "Revolve",
    [
      [0, 3.5],
      [32, 5],
    ],
    "360 deg",
  );
  await body(
    p,
    "Cam ring",
    "Revolve",
    [
      [0, 1.9],
      [7, 3.2],
    ],
    "360 deg",
  );
  await body(
    p,
    "Plunger",
    "Revolve",
    [
      [0, 0],
      [26, 1.5],
    ],
    "360 deg",
  );
  await sample(s, "01-plunger-ring-housing");
  await button(p, "Assembly").click();
  await joint(p, "Cam ring", "revolute", "X", "0 deg", "360 deg");
  await joint(p, "Plunger", "slider", "X", "0 mm", "4 mm");
  await button(p, "Cam & spring").click();
  await field(p, "Cam driver").selectOption({ label: "Cam ring" });
  await field(p, "Follower body").selectOption({ label: "Plunger" });
  await button(p, "Couple bodies").click();
  await p.getByText("Linked to Cam ring.").waitFor();
  await sample(s, "02-link-spring");
  await button(p, "Open 3D assembly").click();
  await field(p, "Component").selectOption({ label: "Cam ring" });
  const samples = [];
  for (const a of [0, 16, 32, 60, 90, 180, 270, 360]) {
    await input(p, "Drive value", a + " deg");
    const read = p.getByRole("region", { name: "Cam coupling" });
    await read.waitFor();
    const text = await read.innerText();
    samples.push({ a, text });
    if (a === 16 || a === 360) await sample(s, "03-cam-" + a);
  }
  assert.equal(samples[0].text, samples.at(-1).text);
  assert.notEqual(samples[0].text, samples[1].text);
  await field(p, "Compare with").selectOption("__all__");
  await p
    .locator("summary")
    .filter({ hasText: "Full-travel resolution" })
    .click();
  await field(p, "Maximum poses per pair").selectOption("513");
  await input(p, "Required clearance", "0.05 mm");
  const report = await jointReport(p, "Full travel");
  await writeFile(
    join(s.dir, "cycle.json"),
    JSON.stringify({ samples, report }, null, 2),
  );
  await sample(s, "04-full-sweep");
  assert(
    report.split("\n").every((row) => /clear throughout/i.test(row)),
    report,
  );
  await native(s, "click-study");
  await button(p, "Part").click();
  await ready(p);
  await stepExport(s, "click-study");
}
async function boltMate(s) {
  const p = s.page;
  await button(p, "Assembly").click();
  const component = field(p, "Component");
  await component.waitFor();
  const nut = (await component.locator("option").allTextContents()).find((n) =>
    n.toLowerCase().includes("nut"),
  );
  assert(nut, "Nut is present in component picker");
  await component.selectOption({ label: nut });
  const movingId = await component.inputValue();
  await button(p, "Mate threads").click({ timeout: 180000 });
  const d = p.getByRole("dialog");
  assert.match(await d.innerText(), /One turn advances 0.8 mm/);
  await d
    .locator("label")
    .filter({ hasText: /^Zero-angle placement/ })
    .locator("select")
    .selectOption("entrances");
  await d.getByLabel(/^Initial engagement/).fill("1 mm");
  await button(d, "Connect threads").click();
  await input(p, "Drive value", "360 deg");
  await p.getByText("Axial travel 0.800 mm", { exact: true }).waitFor();
  await button(p, "Save current pose").click();
  const one = await sample(s, "03-one-turn");
  assert.equal(one.joints.selected, movingId);
  assert.equal(one.joints.current, 360);
  assert.equal(one.joints.lead, 0.8);
  await native(s, "bolt-nut");
  await stepExport(s, "bolt-nut");
}
export async function boltLibrary(s) {
  const p = s.page;
  await newProject(p, /Blank part/);
  for (const k of ["screw", "nut"]) {
    await button(p, "Assembly").click();
    await button(p, "Hardware").first().click();
    const d = p.getByRole("dialog", { name: "Hardware library" });
    await field(d, "Component").selectOption(k);
    await field(d, "Nominal size").selectOption({ label: "M5" });
    await field(d, "Thread detail").selectOption("modeled");
    if (k === "screw") await field(d, "Length").fill("12 mm");
    assert.match(await d.innerText(), /8 mm across flats · 0.8 mm pitch/);
    await button(d, "Insert component").click();
    await d.waitFor({ state: "hidden" });
    await button(p, "Part").click();
    if (k === "screw") {
      await p.waitForFunction(
        () =>
          document.querySelector(".stage-error") ||
          document
            .querySelector(".status-bar")
            ?.innerText.startsWith("Ready\n1 body"),
        null,
        { timeout: 120000 },
      );
      const err = await p.locator(".stage-error").allTextContents();
      if (!err.length)
        throw Error(
          "XPASS INTEROP-001: the modeled M5 × 12 mm screw rebuilt; review its previous XFAIL.",
        );
      assert.match(err.join(" "), /one connected body/);
      await sample(s, "INTEROP-001-modeled-screw", { check: false });
      await native(s, "INTEROP-001");
      await button(p, "Undo").click();
      await ready(p);
      await button(p, "Assembly").click();
      await button(p, "Hardware").first().click();
      const fix = p.getByRole("dialog", { name: "Hardware library" });
      await field(fix, "Component").selectOption("screw");
      await field(fix, "Nominal size").selectOption({ label: "M5" });
      await field(fix, "Length").fill("12 mm");
      await field(fix, "Thread detail").selectOption("cosmetic");
      await button(fix, "Insert component").click();
      await fix.waitFor({ state: "hidden" });
      await button(p, "Part").click();
      console.log("XFAIL INTEROP-001 modeled M5 × 12 mm library screw");
    }
    const x = await sample(
      s,
      k === "screw" ? "01-library-bolt" : "02-library-nut",
    );
    const sizes = Object.entries(x.values);
    assert(
      sizes.some(
        ([n, v]) => n.startsWith(k + "_") && n.endsWith("_pitch") && v === 0.8,
      ),
    );
    assert(
      sizes.some(
        ([n, v]) => n.startsWith(k + "_") && n.endsWith("_diameter") && v === 5,
      ),
    );
  }
  await boltMate(s);
}
export async function boltScratch(s) {
  const p = s.page;
  await newProject(p, /Blank part/);
  const radius = 2.5,
    circle = [
      [radius, 0],
      [0, radius],
      [-radius, 0],
      [0, -radius],
    ];
  await profile(p, circle, "polygon", async (d) => {
    await d.getByRole("button", { name: /^Constraints/ }).click();
    for (let i = 0; i < 4; i++) {
      await button(d, "Add constraint").click();
      await d.locator(".sk-form select").nth(0).selectOption("arc");
      await d.locator(".sk-form select").nth(1).selectOption(String(i));
      await field(d, "Constraint dimension").fill("-2.5");
      await button(d, "Add").click();
    }
  });
  await feature(p, "Extrude", "Hand-built shank", "-8 mm");
  let round = await sample(s, "01-handmade-round-shank");
  assert(Math.abs(round.volume - Math.PI * 2.5 ** 2 * 8) < 0.001);
  let fullLengthError = "";
  try {
    await operation(p, "thread", {
      "Thread size": "M5 × 0.8",
      "Threaded length": "8 mm",
      End: "start",
    });
  } catch (e) {
    fullLengthError = String(e);
  }
  if (!fullLengthError)
    throw Error(
      "XPASS INTEROP-001: full-length hand-sketched M5 thread succeeded.",
    );
  assert.match(fullLengthError, /one connected body/);
  await sample(s, "INTEROP-001-full-length-handmade", { check: false });
  await button(p.getByRole("dialog"), "Cancel").click();
  console.log("XFAIL INTEROP-001 full-length hand-sketched M5 shank");
  await operation(p, "thread", {
    "Thread size": "M5 × 0.8",
    "Threaded length": "4 mm",
    End: "start",
  });
  const hex = Array.from({ length: 6 }, (_, i) =>
    [
      (8 / Math.sqrt(3)) * Math.cos((Math.PI * i) / 3),
      (8 / Math.sqrt(3)) * Math.sin((Math.PI * i) / 3),
    ].map((n) => Number(n.toFixed(8))),
  );
  await body(p, "Hex head", "Extrude", hex, "3.5 mm", "add");
  await sample(s, "02-handmade-head");
  await body(p, "Hand-built nut", "Extrude", hex, "4 mm");
  await operation(p, "hole", {
    Diameter: "5 mm - 0.8 mm * 1.08253175473",
    Termination: "through",
    End: "start",
  });
  await operation(
    p,
    "thread",
    {
      "Thread size": "M5 × 0.8",
      "Threaded length": "4 mm",
      Surface: "internal",
      End: "start",
    },
    { add: true },
  );
  await sample(s, "02-handmade-nut");
  await boltMate(s);
}
export async function coil(s, study) {
  const p = s.page;
  await field(p, "Open Turnmill project file").setInputFiles(study);
  await ready(p);
  await button(p, "Assembly").click();
  await button(p, "Hardware").click();
  const d = p.getByRole("dialog", { name: "Hardware library" });
  await field(d, "Component").selectOption("spring");
  await field(d, "Spring size").selectOption("B18-127CS");
  await button(d, "Insert component").click();
  await d.waitFor({ state: "hidden", timeout: 240000 });
  await button(p, "Part").click();
  await ready(p);
  const model = await sample(s, "01-stock-spring");
  assert.equal(model.bodies.length, 4);
  const spring = model.project.features.find((f) =>
    f.name.includes("B18-127CS"),
  ).name;
  await button(p, "Assembly").click();
  await joint(p, spring, "revolute", "Y", "0 deg", "90 deg");
  await p.locator("summary", { hasText: "Joint frame" }).click();
  await input(p, "offset X", "10 mm");
  await input(p, "Drive value", "90 deg");
  await button(p, "Save current pose").click({ timeout: 240000 });
  await sample(s, "02-seated-spring");
  await field(p, "Component").selectOption({ label: "Cam ring" });
  await field(p, "Compare with").selectOption("__all__");
  await p.locator("summary", { hasText: "Full-travel resolution" }).click();
  await field(p, "Maximum poses per pair").selectOption("513");
  await input(p, "Required clearance", "0.05 mm");
  const report = await jointReport(p, "Full travel");
  await writeFile(join(s.dir, "sweep.txt"), report);
  await sample(s, "03-four-body-sweep");
  await native(s, "click-with-coil");
  await stepExport(s, "click-with-coil");
  assert(report.includes(spring));
  assert(
    report.split("\n").every((line) => /clear throughout/i.test(line)),
    report,
  );
}
