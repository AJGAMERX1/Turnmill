// A supplied URL tests a deployed site. Local runs exercise a release under the Pages subpath.
import { captureViewport } from "./capture.mjs";
import { openBrowser } from "./browser.mjs";
import { serveBuild } from "./serve.mjs";
import {
  newProject,
  profile,
  feature,
  button,
  download,
} from "../projects/support.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const target = process.env.TURNMILL_PAGES_URL;
const server = target
  ? undefined
  : await serveBuild("/Turnmill/", process.env.TURNMILL_RELEASE_DIR || "dist");
const url = target || server.url,
  folder = resolve(process.env.QA_PAGES_EVIDENCE || "test-evidence/pages");
await mkdir(folder, { recursive: true });
const browser = await openBrowser(),
  errors = [],
  warnings = [],
  assets = [];
try {
  const p = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  p.setDefaultTimeout(120000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.type() === "warning") warnings.push(m.text());
  });
  p.on("response", (r) => {
    const addr = new URL(r.url());
    if (addr.origin !== new URL(url).origin) return;
    if (r.status() >= 400) errors.push(addr.pathname + " HTTP " + r.status());
    else if (/\.(wasm|js|css)$/.test(addr.pathname)) assets.push(addr.pathname);
  });
  await p.goto(url);
  await p.getByText("Saved locally", { exact: true }).waitFor();
  assert.equal(
    await p.evaluate(() => Object.hasOwn(window, "__cadTest")),
    false,
    "Production release must exclude the QA hook",
  );
  await newProject(p, /Blank part/);
  await profile(p, [
    [0, 0],
    [20, 10],
  ]);
  await feature(p, "Extrude", "Pages gauge", "5 mm");
  await button(p, "Export").click();
  await download(
    p,
    () => p.getByRole("button", { name: /STEP solid/ }).click(),
    folder + "/gauge.step",
  );
  await captureViewport(p, folder + "/gauge.png");
  await p.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await p.context().setOffline(true);
  await p.reload();
  await p.getByText("Saved locally", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Drawing", exact: true }).click();
  await p.getByRole("img", { name: "Linked part drawing" }).waitFor();
  const info = await p.evaluate(async () => ({
    scope: (await navigator.serviceWorker.getRegistration()).scope,
    crossOriginIsolated,
    cacheKeys: await caches.keys(),
  }));
  assert.equal(new URL(info.scope).pathname, new URL(url).pathname);
  assert.ok(assets.some((p) => p.endsWith(".wasm")));
  assert(assets.every((p) => p.startsWith(new URL(url).pathname)));
  assert.deepEqual(errors, []);
  await writeFile(
    folder + "/browser.json",
    JSON.stringify(
      {
        tested: url,
        mode: target ? "remote" : "local subpath",
        assets: [...new Set(assets)],
        errors,
        warnings,
        ...info,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS release subpath, WASM, 20 × 10 × 5 mm block, STEP export, offline drawing.",
  );
} finally {
  await browser.close();
  server?.close();
}
