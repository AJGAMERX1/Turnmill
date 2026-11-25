import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { createServer } from "vite";
const server = await createServer({
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const { openJournal } = await server.ssrLoadModule("/src/journalStore.ts");
  const { turnedProject } = await server.ssrLoadModule("/src/projects.ts");
  const store = await openJournal();
  assert.equal(await store.load(), null);
  const project = turnedProject();
  for (let i = 0; i <= 60; i++)
    await store.write({ index: i, project: { ...project, name: "Pen " + i } });
  await store.write({ index: 30, project: null });
  // A damaged old row must not prevent opening a valid current project.
  const raw = await new Promise((r) => {
    const op = indexedDB.open("turnmill-projects");
    op.onsuccess = () => r(op.result);
  });
  await new Promise((r) => {
    const tx = raw.transaction("journal", "readwrite");
    tx.objectStore("journal").put({ damaged: true }, 2);
    tx.oncomplete = r;
  });
  raw.close();
  const other = await openJournal();
  assert.deepEqual(await other.load(), {
    index: 30,
    last: 60,
    project: { ...project, name: "Pen 30" },
  });
  assert.equal((await other.read(17)).name, "Pen 17");
  await assert.rejects(() => other.read(2));
  await store.write({ index: 31, project: { ...project, name: "Short pen" } });
  await assert.rejects(
    () => other.write({ index: 32, project }),
    /another tab/i,
  );
  await assert.rejects(() => other.read(30), /another tab/i);
  const restored = await openJournal();
  assert.equal((await restored.load()).last, 31);
  assert.equal((await restored.read(31)).name, "Short pen");
  await assert.rejects(() => restored.read(32));
  store.close();
  other.close();
  restored.close();
  console.log(
    "PASS lazy undo journal, legacy snapshots, corrupted old entry, redo branch truncation, concurrent tab protection.",
  );
} finally {
  await server.close();
}
