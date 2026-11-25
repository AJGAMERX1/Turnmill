import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
});
try {
  const { commandKey, keyBinding, searchCommands, workspaceCommands } =
    await server.ssrLoadModule("/src/commands.ts");
  const item = (title, keywords, alias, disabled = false) => ({
    title,
    key: commandKey(title),
    group: "Model",
    keywords,
    alias,
    disabled,
    run() {},
  });
  const commands = [
    item("New sketch", "profile", "01"),
    item("Revolve profile", "lathe round rotational", "02"),
    item("Add axial hole", "drill counterbore countersink", "03", true),
    item("Add dimension", "measure center distance", "04"),
    item("Edit Width", "", "05"),
    item("Widths by tick rank", "", "06"),
  ];
  const top = (query, recent = []) =>
    searchCommands(commands, query, recent)[0];
  assert.equal(top("lathe").title, "Revolve profile");
  assert.equal(top("how do I make a hole").title, "Add axial hole");
  assert.equal(top("revlove").title, "Revolve profile");
  assert.equal(top("drill").disabled, true);
  assert.equal(top("Width").title, "Edit Width");
  assert.equal(top(":add-dimension").title, "Add dimension");
  assert.equal(top("#04").title, "Add dimension");
  assert.equal(top("04").title, "Add dimension");
  assert.equal(top("", ["add-dimension"]).title, "Add dimension");
  assert.equal(top("xyzyzy"), undefined);
  assert.equal(
    commandKey("Bill of materials (4)"),
    commandKey("Bill of materials (2)"),
  );
  const rearranged = commands.toReversed();
  assert.equal(
    searchCommands(rearranged, ":revolve-profile")[0].title,
    "Revolve profile",
  );
  const ev = (key, extra = {}) => ({
    key,
    code: "Key" + key.toUpperCase(),
    ...extra,
  });
  assert.equal(keyBinding(ev("s", { ctrlKey: true })), "⌘ S");
  assert.equal(keyBinding(ev("z", { metaKey: true, shiftKey: true })), "⌘ ⇧ Z");
  assert.equal(keyBinding(ev("®", { altKey: true, code: "KeyR" })), "Alt R");
  assert.equal(
    keyBinding(ev("ArrowUp", { altKey: true, code: "ArrowUp" })),
    "Alt ↑",
  );
  assert.equal(keyBinding(ev("x", { isComposing: true })), "");
  assert.equal(keyBinding(ev("Backspace", { repeat: true })), "");
  assert.equal(keyBinding(ev("k", { metaKey: true, altKey: true })), "");
  assert.equal(keyBinding(ev("G", { shiftKey: true })), "");
  assert.equal(keyBinding(ev("?", { shiftKey: true })), "?");
  const destinations = workspaceCommands(
    "Part",
    1,
    () => {},
    () => {},
  );
  assert.equal(
    destinations.find((c) => c.title.includes("clearance check")).disabled,
    true,
  );
  assert.equal(
    destinations.find((c) => c.title.includes("PDF")).disabled,
    false,
  );
  console.log(
    "Passed palette search, exact command keys, spelling and maker synonyms, recent ranking, unavailable commands, and protected key bindings.",
  );
} finally {
  await server.close();
}
