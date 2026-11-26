import assert from "node:assert/strict";
import { Matrix4 } from "three";
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

  const { applyAllPartsPose, allPartsMatrices } = await server.ssrLoadModule("/src/allPartsPose.ts");
  const barrel = project.features[0].id;
  const bias = new Matrix4().makeRotationZ(Math.PI / 3).setPosition(13, -4, 5).toArray();
  const vanilla = new Matrix4().toArray();
  assert.equal(allPartsMatrices(project, [barrel]), undefined);
  assert.throws(() => applyAllPartsPose(project, {}), /finish rebuilding/);
  assert.throws(() => applyAllPartsPose(project, { [barrel]: bias }, { [barrel]: [NaN] }), /finite joint position/);
  const live = { [barrel]: [2.5] };
  const applied = applyAllPartsPose(project, { [barrel]: [...bias], removed: vanilla }, live);
  live[barrel][0] = 0;
  assert.deepEqual(applied.workspaces.jointPose[barrel], [2.5]);
  assert.deepEqual(Object.keys(applied.workspaces.allPartsPose), [barrel], "stale bodies are excluded from capture");
  await restored.write({ index: 32, project: applied });
  const reopened = await openJournal();
  const persisted = (await reopened.load()).project;
  assert.deepEqual(allPartsMatrices(persisted, ["new-part", barrel]), [vanilla, bias], "resolve by body ID after history changes");
  assert.equal(allPartsMatrices(persisted, ["new-part"]), undefined);
  assert.deepEqual(persisted.workspaces.jointPose, { [barrel]: [2.5] });
  await reopened.write({ index: 31, project: null });
  assert.equal(allPartsMatrices((await reopened.load()).project, [barrel]), undefined, "Undo removes capture");
  await reopened.write({ index: 32, project: null });
  assert.deepEqual(allPartsMatrices((await reopened.load()).project, [barrel]), [bias], "Redo restores capture");
  reopened.close();
  store.close();
  other.close();
  restored.close();
  console.log(
    "PASS lazy undo journal, legacy snapshots, corrupted old entry, redo branch truncation, concurrent tab protection.",
  );
} finally {
  await server.close();
}
