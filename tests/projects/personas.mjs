import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile, appendFile } from "node:fs/promises";
import {
  button,
  field,
  input,
  ready,
  saved,
  snap,
  sample,
  command,
  download,
} from "./support.mjs";

async function tabTo(p, fn) {
  for (let i = 0; i < 160; i++) {
    const node = await p.evaluate(() => {
      const n = document.activeElement;
      return {
        tag: n.tagName,
        text: n.innerText || "",
        title: n.title || "",
        label: n.getAttribute("aria-label") || "",
      };
    });
    if (fn(node)) return;
    await p.keyboard.press("Tab");
  }
  throw Error("The requested control was not reachable in 160 Tab presses");
}
export async function power(s) {
  const p = s.page;
  const key = async (query) => {
    await p.keyboard.press("Control+k");
    const box = p
      .getByRole("dialog", { name: "Command palette" })
      .getByRole("combobox");
    await box.waitFor();
    await p.keyboard.type(query);
    await p.keyboard.press("Enter");
    await p
      .getByRole("dialog", { name: "Command palette" })
      .waitFor({ state: "hidden" });
  };
  await key(":new-project");
  await tabTo(
    p,
    (n) => n.tag === "BUTTON" && n.text.includes("Twist pen assembly"),
  );
  await p.keyboard.press("Enter");
  await ready(p);
  await key(":named-parameters");
  await key(":edit-expression-for-refill-diameter");
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.type("5.75 mm");
  await key(":apply-parameters");
  await ready(p);
  const edited = await sample(s, "01-keyboard-parameter");
  assert(Math.abs(edited.values.refill_diameter - 5.75) < 0.001);
  await tabTo(
    p,
    (n) =>
      n.title.includes("Select feature") &&
      /^Refill(?:\s|$)/.test(n.text.trim()),
  );
  await p.keyboard.press("Enter");
  await p.keyboard.press("F2");
  await tabTo(p, (n) => n.tag === "INPUT");
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.type("Keyboard refill");
  await p.keyboard.press("Enter");
  const renamed = await sample(s, "02-rename");
  assert(renamed.project.features.some((f) => f.name === "Keyboard refill"));
  await key(":move-feature-earlier");
  const moved = await sample(s, "03-reorder");
  const a = renamed.project.features.findIndex(
      (f) => f.name === "Keyboard refill",
    ),
    b = moved.project.features.findIndex((f) => f.name === "Keyboard refill");
  assert.equal(b, a - 1);
  await p.keyboard.press("Control+z");
  const undo = await sample(s, "04-undo");
  assert.deepEqual(undo.project.features, renamed.project.features);
  await p.keyboard.press("Control+Shift+z");
  const redo = await sample(s, "05-redo");
  assert.deepEqual(redo.project.features, moved.project.features);
}

export async function chaos(s) {
  const p = s.page,
    seed = 0x50454e35;
  let state = seed;
  const rand = (n) => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return Math.floor((state / 4294967296) * n);
  };
  const log = join(s.dir, "actions.jsonl");
  await writeFile(log, "");
  async function act(action, args, fn) {
    await appendFile(
      log,
      JSON.stringify({ t: new Date().toISOString(), seed, action, args }) +
        "\n",
    );
    return fn();
  }
  for (const n of [95, 96, 97]) {
    await act("set Barrel length", n, () =>
      input(p, "Barrel length", String(n) + " mm"),
    );
    await ready(p);
  }
  await saved(p);
  const initial = await sample(s, "01-committed");
  assert.equal(initial.values.barrel_length, 97);
  const stage = p.locator(".stage canvas").first(),
    rect = await stage.boundingBox();
  assert(rect);
  for (let i = 0; i < 25; i++) {
    const x = Math.round(rect.x + rect.width * (0.15 + rand(65) / 100)),
      y = Math.round(rect.y + rect.height * (0.24 + rand(52) / 100));
    const kind =
      i % 5 === 0 ? "doubleclick" : i % 3 === 0 ? "offscreen drag" : "click";
    await act(kind, { x, y }, async () => {
      if (kind === "offscreen drag") {
        await p.mouse.move(x, y);
        await p.mouse.down();
        await p.mouse.move(-40, y - 60, { steps: 5 });
        await p.mouse.up();
      } else if (kind === "doubleclick") await p.mouse.dblclick(x, y);
      else await p.mouse.click(x, y);
    });
  }
  await act("begin sketch", {}, () =>
    button(p.locator(".model-tools"), "Sketch").click(),
  );
  for (const [w, h] of [
    [600, 790],
    [390, 825],
    [1440, 930],
  ])
    await act("resize with open sketch", { w, h }, () =>
      p.setViewportSize({ width: w, height: h }),
    );
  await sample(s, "02-resize-open-sketch", { check: false });
  await act("cancel sketch", {}, () =>
    button(p.getByRole("dialog"), "Cancel").click(),
  );
  for (let i = 0; i < 50; i++) {
    await act("undo", { i }, () => p.keyboard.press("Control+z"));
    await act("redo", { i }, () => p.keyboard.press("Control+Shift+z"));
  }
  await saved(p);
  const churn = await sample(s, "03-after-50-pairs");
  assert.deepEqual(
    churn.project,
    initial.project,
    "No model change after 50 undo/redo pairs",
  );
  await act("draft then reload", 101, async () => {
    await field(p, "Barrel length").fill("101 mm");
    await p.reload();
    await ready(p);
  });
  const reloaded = await sample(s, "04-reload-uncommitted");
  assert.equal(reloaded.values.barrel_length, 97);
  const tab = await s.ctx.newPage();
  await act("open competing tab", {}, async () => {
    await tab.goto(p.url());
    await ready(tab);
  });
  await act("first-tab edit", 99, async () => {
    await input(p, "Barrel length", "99 mm");
    await saved(p);
  });
  await act("other-tab edit", 103, () => input(tab, "Barrel length", "103 mm"));
  await tab.getByText(/Another tab saved a newer revision/).waitFor();
  await tab.screenshot({ path: join(s.dir, "05-conflict.png") });
  await download(
    tab,
    () => button(tab, "Save project file").click(),
    join(s.dir, "rescued-103mm.turnmill"),
  );
  await act("close losing tab without autosave", {}, () => tab.close());
  await act("reload surviving tab", {}, async () => {
    await p.reload();
    await ready(p);
  });
  const last = await sample(s, "06-winner");
  assert.equal(last.values.barrel_length, 99);
}
