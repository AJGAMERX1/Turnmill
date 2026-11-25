const { chromium } = require("playwright-core");
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const root = process.env.TURNMILL_URL || "http://127.0.0.1:4197/",
  opt = {
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    serviceWorkers: "block",
  };
const button = (p, name) => p.getByRole("button", { name, exact: true });
const legacy = (i) => "Legacy " + String(i).padStart(2, "0");
const results = [],
  errors = [];
function mark(name, detail) {
  results.push({ name, detail });
  console.log(name, detail ?? "");
}
function attach(p) {
  p.setDefaultTimeout(13000);
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
function instrument() {
  window.journalAccess = [];
  for (const op of ["get", "getAll", "openCursor", "openKeyCursor"]) {
    const old = IDBObjectStore.prototype[op];
    IDBObjectStore.prototype[op] = function (...args) {
      if (this.name === "journal") window.journalAccess.push([op, args[0]]);
      return old.apply(this, args);
    };
  }
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args);
    if (
      window.abortNextJournal &&
      args[1] === "readwrite" &&
      tx.objectStoreNames.contains("journal")
    ) {
      window.abortNextJournal = false;
      queueMicrotask(() => tx.abort());
    }
    return tx;
  };
}
async function named(p, name) {
  await p.waitForFunction(
    (n) => document.querySelector(".project-trigger span")?.textContent === n,
    name,
  );
}
const state = (p, s) =>
  p.waitForFunction(
    (s) => document.querySelector(".save-state")?.textContent.includes(s),
    s,
  );
async function saved(p, name) {
  await named(p, name);
  await state(p, "Saved locally");
}
async function rename(p, name) {
  await p.locator(".project-trigger").click();
  await button(p, "Rename project").click();
  await p.getByLabel("Project name").fill(name);
  await button(p, "Save name").click();
  await named(p, name);
}
async function snapshot(p) {
  return p.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open("turnmill-projects");
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    try {
      const tx = db.transaction(["state", "journal"]);
      const store = tx.objectStore("journal"),
        m = tx.objectStore("state"),
        c = m.get("cursor"),
        v = m.get("revision"),
        k = store.getAllKeys();
      let row;
      c.onsuccess = () => {
        row = store.get(c.result);
      };
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      return {
        keys: k.result,
        cursor: c.result,
        revision: v.result,
        project: row.result,
      };
    } finally {
      db.close();
    }
  });
}
async function download(p) {
  const [d] = await Promise.all([
    p.waitForEvent("download"),
    p
      .locator(".save-state")
      .getByRole("button", { name: "Save project file", exact: true })
      .click(),
  ]);
  assert(d.suggestedFilename().endsWith(".turnmill"));
  return {
    path: await d.path(),
    data: JSON.parse(await fs.readFile(await d.path(), "utf8")),
  };
}
(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: [
      "--enable-webgl",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  try {
    const ctx = await b.newContext(opt);
    await ctx.addInitScript(instrument);
    const p = attach(await ctx.newPage());
    await p.route("**/seed", (r) =>
      r.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>Legacy seed</title>",
      }),
    );
    await p.goto(root + "seed");
    const base = JSON.parse(
      await fs.readFile(
        path.join(__dirname, "fixtures/legacy.turnmill"),
        "utf8",
      ),
    );
    await p.evaluate(async (base) => {
      const req = indexedDB.open("turnmill-projects", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("journal");
        req.result.createObjectStore("state");
      };
      const db = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const tx = db.transaction(["journal", "state"], "readwrite");
      const rows = tx.objectStore("journal");
      for (let i = 0; i < 85; i++)
        rows.add({ ...base, name: "Legacy " + String(i).padStart(2, "0") }, i);
      tx.objectStore("state").put(57, "cursor");
      tx.objectStore("state").put(123, "revision");
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    }, base);
    await p.goto(root);
    await saved(p, legacy(57));
    const reads = await p.evaluate(() => window.journalAccess);
    assert.deepEqual(
      reads.filter((a) => a[0] !== "openKeyCursor"),
      [["get", 57]],
    );
    assert.equal(reads.filter((a) => a[0] === "openKeyCursor").length, 1);
    mark(
      "85 version-one snapshots opened with one payload read and one key cursor",
      reads,
    );
    for (let i = 56; i >= 26; i--) {
      await button(p, "Undo").click();
      await named(p, legacy(i));
    }
    for (let i = 27; i <= 31; i++) {
      await button(p, "Redo").click();
      await named(p, legacy(i));
    }
    await saved(p, legacy(31));
    assert.equal((await snapshot(p)).cursor, 31);
    await p.reload();
    await saved(p, legacy(31));
    assert(
      (await button(p, "Redo").isEnabled()) &&
        (await button(p, "Undo").isEnabled()),
    );
    for (let i = 0; i < 7; i++) await p.keyboard.press("Control+z");
    await saved(p, legacy(24));
    for (let i = 0; i < 4; i++) await p.keyboard.press("Control+Shift+z");
    await saved(p, legacy(28));
    assert.equal((await snapshot(p)).cursor, 28);
    mark(
      "Undo and Redo through cache eviction and across reload; rapid shortcuts restore exact revision",
      28,
    );
    await rename(p, "Edited branch");
    await saved(p, "Edited branch");
    let disk = await snapshot(p);
    assert.equal(disk.cursor, 29);
    assert.deepEqual(
      disk.keys,
      Array.from({ length: 30 }, (_, i) => i),
    );
    assert(!(await button(p, "Redo").isEnabled()));
    await button(p, "Undo").click();
    await saved(p, legacy(28));
    await button(p, "Redo").click();
    await saved(p, "Edited branch");
    await p.reload();
    await saved(p, "Edited branch");
    assert(!(await button(p, "Redo").isEnabled()));
    mark(
      "Branch replaced discarded redo snapshots and survived reload",
      disk.keys.length,
    );
    await p.evaluate(() => (window.abortNextJournal = true));
    await rename(p, "Unsaved retry draft");
    await state(p, "Autosave failed");
    assert.equal((await snapshot(p)).project.name, "Edited branch");
    const retryFile = await download(p);
    assert.equal(retryFile.data.name, "Unsaved retry draft");
    assert.deepEqual(retryFile.data.parameters, base.parameters);
    await p
      .locator(".save-state")
      .getByRole("button", { name: "Retry autosave" })
      .click();
    await saved(p, "Unsaved retry draft");
    assert.equal((await snapshot(p)).project.name, "Unsaved retry draft");
    await p.reload();
    await saved(p, "Unsaved retry draft");
    mark(
      "Real abort on local transaction left an editable downloadable draft; Retry autosave persisted it",
    );
    const q = attach(await ctx.newPage());
    await q.goto(root);
    await saved(q, "Unsaved retry draft");
    await rename(p, "First tab revision");
    await saved(p, "First tab revision");
    const first = await snapshot(p);
    await rename(q, "Other tab draft");
    await state(q, "Another tab saved");
    const conflictFile = await download(q);
    assert.equal(conflictFile.data.name, "Other tab draft");
    assert.deepEqual(conflictFile.data.features, base.features);
    const latest = await snapshot(q);
    assert.equal(latest.project.name, "First tab revision");
    assert.equal(latest.revision, first.revision);
    await q.reload();
    await saved(q, "First tab revision");
    mark(
      "Concurrent stale tab offered native recovery and preserved the first tab on disk",
    );
    const closed = await b.newContext(opt);
    await closed.addInitScript(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, ...args) {
        if (name === "turnmill-projects")
          throw new DOMException("Storage disabled", "SecurityError");
        return open.call(this, name, ...args);
      };
    });
    const disabled = attach(await closed.newPage());
    await disabled.goto(root);
    await state(disabled, "Autosave unavailable");
    const defaultName = await disabled
      .locator(".project-trigger span")
      .textContent();
    await rename(disabled, "Storage disabled draft");
    await button(disabled, "Undo").click();
    await named(disabled, defaultName);
    await button(disabled, "Redo").click();
    await named(disabled, "Storage disabled draft");
    const rescueFile = await download(disabled);
    assert.equal(rescueFile.data.name, "Storage disabled draft");
    await q.locator(".project-trigger").click();
    const [fc] = await Promise.all([
      q.waitForEvent("filechooser"),
      q.getByRole("button", { name: /^Open project/ }).click(),
    ]);
    await fc.setFiles({
      name: "Recovered.turnmill",
      mimeType: "application/json",
      buffer: await fs.readFile(rescueFile.path),
    });
    await saved(q, "Storage disabled draft");
    assert.deepEqual(
      (await snapshot(q)).project.parameters,
      rescueFile.data.parameters,
    );
    mark(
      "Disabled browser storage retained in-session undo/redo and a native download reopened into a writable journal",
    );
    assert.deepEqual(errors, []);
    mark("Zero page exceptions");
    await fs.writeFile(
      path.resolve("test-evidence/browser/history.json"),
      JSON.stringify({ results, errors }, null, 2),
    );
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
