import { captureViewport } from "../qa/capture.mjs";
import { measure, openBrowser } from "../qa/browser.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

export const url =
  process.env.TURNMILL_QA_URL ||
  process.env.TURNMILL_URL ||
  "http://127.0.0.1:4197/";
export const out = resolve(
  process.env.TURNMILL_PROJECT_EVIDENCE || "test-evidence/projects",
);
export const button = (r, name) => r.getByRole("button", { name, exact: true });
export const field = (r, name) => r.getByLabel(name, { exact: true });
export async function input(r, name, value, commit = true) {
  const el = field(r, name);
  await el.fill(String(value));
  if (commit) await el.press("Enter");
}
export const ready = (p) =>
  p.waitForFunction(
    () => document.querySelector(".status-bar > span:first-child")?.textContent.trim() === "Ready",
    null,
    { polling: 100, timeout: 240000 },
  );
export const saved = (p) =>
  p.waitForFunction(
    () =>
      document
        .querySelector(".save-state")
        ?.textContent.includes("Saved locally"),
    null,
    { polling: 100, timeout: 12000 },
  );
export { measure as snap };
export async function sample(s, name, { check = true } = {}) {
  const { page: p, dir } = s;
  if (check) {
    await ready(p);
    if (await p.locator(".joint-stage canvas").count())
      await p
        .locator(".joint-stage .joint-message")
        .waitFor({ state: "hidden", timeout: 240000 });
  }
  const pic = join(dir, name + ".png");
  await captureViewport(p, pic);
  const x = check ? await measure(p) : await p.evaluate(() => window.__cadTest.snapshot())
      .catch((e) => ({ error: e.message })),
    props = p.locator(".properties");
  const measurements = (await props.isVisible())
    ? await props.innerText()
    : null;
  const drive = p.locator('input[aria-label="Drive value"]');
  const jointUi = (await drive.count())
    ? {
        value: Number(await drive.inputValue()),
        measure: await p.locator(".joint-driver").innerText(),
        readings: await p
          .getByRole("region", { name: "Cam coupling" })
          .allInnerTexts(),
      }
    : null;
  if (check && jointUi && x.joints) {
    assert(
      Math.abs(x.joints.current - jointUi.value) <= 0.0001,
      "Displayed drive agrees with model state",
    );
    if (jointUi.measure.includes("Axial travel")) {
      const shown = Number(
        jointUi.measure.match(/Axial travel ([+-]?[.\d]+) mm/)[1],
      );
      assert(
        Math.abs(shown - (x.joints.current * x.joints.lead) / 360) < 0.00051,
      );
    }
  }
  const data = {
    jointUi,
    time: new Date().toISOString(),
    stage: name,
    mode: x.mode,
    busy: x.busy,
    error: x.error,
    status: await p.locator(".status-bar").innerText(),
    projectName: x.project?.name,
    parameters: x.values,
    features: x.project?.features?.map((f) => ({
      name: f.name,
      id: f.id,
      suppressed: f.suppressed,
      operation: f.operation,
      finishes: f.finishes,
    })),
    mass: x.mass,
    centerOfMass: x.centerOfMass,
    volume: x.volume,
    area: x.area,
    bodies: x.bodies,
    joints: x.joints,
    inspector: measurements,
    console: s.events.splice(0),
  };
  await writeFile(join(dir, name + ".json"), JSON.stringify(data, null, 2));
  if (check) {
    assert(!x.busy, "snapshot should be current");
    assert(!x.error, x.error);
    if (x.bodies?.length)
      assert(
        x.bodies.every((b) => b.valid !== false),
        "valid B-reps",
      );
    if (measurements && x.mass != null && x.centerOfMass) {
      const m = await props
        .locator("dt", { hasText: /^Mass$/ })
        .locator("..")
        .locator("dd")
        .innerText();
      const b = await props
        .locator("dt", { hasText: "Balance along X" })
        .locator("..")
        .locator("dd")
        .innerText();
      if (
        (await p.getByLabel("Measure mass and balance for").count()) === 0 ||
        (await p.getByLabel("Measure mass and balance for").inputValue()) ===
          "all"
      ) {
        assert(
          Math.abs(parseFloat(m.replaceAll(",", "")) - x.mass) <= 0.0051,
          "Displayed mass agrees with exact model after UI rounding",
        );
        assert(
          Math.abs(parseFloat(b.replaceAll(",", "")) - x.centerOfMass[0]) <=
            0.0051,
          "Displayed X balance agrees within rounding",
        );
      }
    }
  }
  console.log(s.name, name);
  return x;
}
export async function download(p, trigger, path) {
  const promise = p.waitForEvent("download", { timeout: 240000 });
  await trigger();
  const dl = await promise;
  await dl.saveAs(path);
  assert.equal(await dl.failure(), null);
}
export async function openExport(page, preset = "Production package") {
  await button(page, "Export").click();
  const dialog = page.getByRole("dialog", { name: "Export", exact: true });
  await button(dialog, preset).click();
  return dialog;
}

export async function singleFileDownload(page, format, scope) {
  const dialog = await openExport(page, "Single file");
  await dialog.getByRole("combobox", { name: /^File format/ }).selectOption(format);
  if (scope) await dialog.getByRole("combobox", { name: /^Export geometry/ }).selectOption(scope);
  const name = format === "turnmill" ? "project" : format.toUpperCase();
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 240000 }),
    button(dialog, "Download " + name).click(),
  ]);
  assert.equal(await file.failure(), null);
  if (await dialog.isVisible()) await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  return file;
}

export const native = (s, file) =>
  download(
    s.page,
    async () => {
      await s.page.locator(".project-trigger").click();
      await s.page.getByRole("button", { name: /Save project file/ }).click();
    },
    join(s.dir, file + ".turnmill"),
  );
export async function stepExport(s, file) {
  const view = await measure(s.page);
  if (view.mode === "Assembly") {
    assert(view.joints?.matrices.length === view.bodies.length && !view.joints.problem);
    await writeFile(join(s.dir, file + ".pose.json"), JSON.stringify({
      ids: view.joints.ids,
      matrices: view.joints.matrices,
      drivers: view.joints.poses,
      localCenters: view.bodies.map((body) => body.center),
    }, null, 2));
  }
  await (await singleFileDownload(s.page, "step")).saveAs(join(s.dir, file + ".step"));
}
export async function newProject(p, label) {
  await p.locator(".project-trigger").click();
  await p.getByRole("button", { name: /^New project/ }).click();
  await p.getByRole("dialog").getByRole("button", { name: label }).click();
  await ready(p);
}
export async function command(p, query) {
  const palette = p.getByRole("dialog", { name: "Command palette" });
  await p.keyboard.press("Control+k");
  const q = palette.getByRole("combobox");
  await q.fill(query);
  const first = palette.locator("[role=option][aria-selected=true]");
  assert(await first.count(), "Available command " + query);
  await q.press("Enter");
  await palette.waitFor({ state: "hidden" });
}
export async function profile(p, points, kind = "rectangle", beforeFinish) {
  await button(p.locator(".model-tools"), "Sketch").click();
  const d = p.getByRole("dialog", { name: "Sketch editor" });
  await button(d, "Draw a replacement " + kind).click();
  for (const [x, y] of points) {
    await input(d, "Place vertex X", x, false);
    await input(d, "Place vertex Y", y, false);
    await button(d, "Place point").click();
  }
  if (kind === "polygon") await button(d, "Close profile").click();
  if (beforeFinish) await beforeFinish(d);
  await button(d, "Finish sketch").click();
  await d.waitFor({ state: "hidden" });
}
export async function feature(p, kind, name, amount, op = "new") {
  await button(p.locator(".model-tools"), kind).click();
  const d = p.getByRole("dialog");
  await input(d, "Feature name", name, false);
  await input(
    d,
    kind === "Revolve" ? "Angle about X" : "Depth along Z",
    amount,
    false,
  );
  await d
    .locator("label")
    .filter({ hasText: /^Operation/ })
    .locator("select")
    .selectOption(op);
  await button(d, "Create feature").click();
  await d.waitFor({ state: "hidden" });
  await ready(p);
}
export async function operation(p, kind, values, { add = false } = {}) {
  await button(p.locator(".model-tools"), "Finish").click();
  const d = p.getByRole("dialog");
  if (add) await button(d, "Add finish").click();
  await field(d, "Operation").selectOption(kind);
  for (const [k, v] of Object.entries(values)) {
    const e = field(d, k);
    if (await e.evaluate((n) => n.tagName === "SELECT"))
      await e.selectOption(v);
    else await e.fill(v);
  }
  await button(d, "Apply finishes").click();
  await p.waitForFunction(
    () =>
      !document.querySelector("dialog[open]") ||
      document.querySelector(".finish-footer [role=alert]"),
    null,
    { polling: 100, timeout: 240000 },
  );
  if (await d.isVisible())
    throw Error("Finish rejected: " + (await d.getByRole("alert").innerText()));
  await ready(p);
}
export async function jointReport(p, kind) {
  await button(p, kind).click();
  await p.waitForFunction(
    () => {
      const msg = document.querySelector(
        ".joint-check p[role=status]",
      )?.textContent;
      return msg && !/^(Checking|Checked|Measuring)/.test(msg);
    },
    null,
    { polling: 100, timeout: 360000 },
  );
  return p.locator(".joint-check p[role=status]").innerText();
}
export async function run(name, fn) {
  await mkdir(out, { recursive: true });
  const dir = join(out, name);
  await mkdir(dir, { recursive: true });
  const b = await openBrowser({ displayEvidence: true });
  const ctx = await b.newContext({
      viewport: { width: 1440, height: 930 },
      acceptDownloads: true,
    }),
    p = await ctx.newPage(),
    events = [],
    errors = [];
  const log = (type, value) => {
    const event = { time: new Date().toISOString(), type, value };
    events.push(event);
    if (type === "pageerror") errors.push(event);
  };
  // Keep actual preview and main-worker status transitions even if a later wait
  // times out. The observer reads the rendered UI and never replays an edit.
  const readiness = [];
  await p.exposeFunction("recordCadReadiness", (row) => { readiness.push(row); });
  await p.addInitScript(() => {
    let lastStatus, lastFinish;
    function record() {
      const status = document.querySelector(".status-bar > span:first-child")?.textContent.trim();
      if (!status) return;
      const footer = document.querySelector("dialog[open] .finish-footer");
      const finish = footer
        ? footer.querySelector("[role=alert], [role=status]")?.textContent.trim() || "Editing"
        : null;
      if (status === lastStatus && finish === lastFinish) return;
      lastStatus = status;
      lastFinish = finish;
      void window.recordCadReadiness({ timeMs: Date.now(), status, finish });
    }
    new MutationObserver(record).observe(document, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ["open"],
    });
  });
  ctx.on("page", (page) => listen(page));
  function listen(page) {
    page.on("pageerror", (e) => log("pageerror", e.message));
    page.on("console", (m) => {
      if (["warning", "error"].includes(m.type()))
        log(m.type(), m.text().slice(0, 1000));
    });
    page.on("requestfailed", (r) =>
      log("requestfailed", r.url() + " " + r.failure()?.errorText),
    );
    page.on("response", (r) => {
      if (r.status() >= 400) log("HTTP " + r.status(), r.url());
    });
  }
  listen(p);
  p.setDefaultTimeout(20000);
  p.on("dialog", (d) => d.accept());
  const s = { page: p, ctx, dir, name, events, readiness };
  let status = "PASS",
    message = "";
  try {
    await p.goto(url);
    await ready(p);
    if (!(await p.evaluate(() => Boolean(window.__cadTest))))
      throw Error("QA production build required; no read-only __cadTest hook.");
    await fn(s);
    assert.deepEqual(errors, []);
  } catch (e) {
    status = "FAIL";
    message = String(e.stack || e);
    await writeFile(
      join(dir, "failure.txt"),
      message +
        "\n" +
        (await p
          .locator("body")
          .innerText()
          .catch(() => "")),
    );
    await captureViewport(p, join(dir, "failure.png")).catch(() => {});
  } finally {
    if (status === "PASS") {
      await rm(join(dir, "failure.txt"), { force: true });
      await rm(join(dir, "failure.png"), { force: true });
    }
    await writeFile(
      join(dir, "end.json"),
      JSON.stringify({ status, message, events, errors, readiness }, null, 2),
    );
    await b.close();
  }
  return { name, status, message };
}
