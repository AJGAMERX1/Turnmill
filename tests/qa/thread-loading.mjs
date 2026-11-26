import assert from "node:assert/strict";
import { button, field, saved } from "../projects/support.mjs";
import { runtime } from "../systems/runtime.mjs";
import { appUrl, openBrowser } from "./browser.mjs";
import { cappedPen } from "./fixtures/capped-pen.mjs";

const api = await runtime(false);
let browser;
try {
  const fixture = await cappedPen(api);
  const damaged = structuredClone(fixture.document);
  damaged.name = "Pen with removed socket thread";
  const socket = damaged.workspaces.joints[fixture.coneId].threadMate.mating;
  const parent = damaged.features.find(f => f.id === socket.featureId);
  assert(parent.finishes.some(f => f.id === socket.finishId));
  parent.finishes = parent.finishes.filter(f => f.id !== socket.finishId);

  browser = await openBrowser();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // Hold the real worker requests so the intermediate state is deterministic,
  // then let the same workers build and measure the real OpenCascade geometry.
  await page.addInitScript(() => {
    const pending = { solid: [], assembly: [] };
    const held = { solid: false, assembly: false };
    window.threadBuilds = {
      held, pending,
      release(target) {
        held[target] = false;
        for (const send of pending[target].splice(0)) send();
      },
    };
    window.Worker = class extends Worker {
      constructor(url, options) {
        super(url, options);
        this.target = options?.name === "turnmill-solid-modeler" ? "solid"
          : String(url).includes("motionWorker") ? "assembly" : undefined;
      }
      postMessage(data, ...rest) {
        const send = () => super.postMessage(data, ...rest);
        if (this.target && held[this.target] && data.type === "build" && data.features.length) {
          pending[this.target].push(send);
        } else send();
      }
    };
  });
  const mode = name => button(page.getByRole("navigation", { name: "Workspaces" }), name).click();
  const missing = page.getByRole("alert").filter({ hasText: "A linked thread is missing" });
  const png = button(page, "Save PNG"), savePose = button(page, "Save current pose");
  async function hold(target) {
    await page.evaluate(t => window.threadBuilds.held[t] = true, target);
  }
  async function waitPending(target) {
    await page.waitForFunction(t => window.threadBuilds.pending[t].length > 0, target, { timeout: 30000 });
  }
  async function release(target) {
    await page.evaluate(t => window.threadBuilds.release(t), target);
  }
  async function open(doc) {
    await field(page, "Open Turnmill project file").setInputFiles({
      name: "synthetic-threads.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)),
    });
    await page.locator(".project-trigger").filter({ hasText: doc.name }).waitFor();
  }
  await page.goto(appUrl);
  await saved(page);
  for (const [doc, shouldFail] of [[fixture.document, false], [damaged, true]]) {
    await hold("solid");
    await open(doc);
    await mode("Pen Studio");
    await waitPending("solid");
    assert(await png.isDisabled());
    assert.equal(await missing.count(), 0, "Pen Studio must wait for current thread frames");
    await release("solid");
    if (shouldFail) {
      await missing.waitFor();
      assert(await png.isDisabled());
    } else {
      await png.click({ trial: true });
      assert.equal(await missing.count(), 0);
    }
    await hold("assembly");
    await mode("Assembly");
    await waitPending("assembly");
    await page.getByText("Building assembly…", { exact: true }).waitFor();
    assert(await savePose.isDisabled());
    assert.equal(await missing.count(), 0, "Assembly must wait for its current meshes");
    await release("assembly");
    if (shouldFail) {
      await missing.waitFor();
      assert(await savePose.isDisabled());
    } else {
      await savePose.click({ trial: true });
      assert.equal(await missing.count(), 0);
    }
    await mode("Part");
  }
  assert.deepEqual(errors, []);
  console.log("PASS valid and missing thread connections during delayed builds in Pen Studio and Assembly.");
} finally {
  await browser?.close();
  await api.close();
}
