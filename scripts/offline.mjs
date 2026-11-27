import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
async function walk(dir) {
  const out = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) out.push(...(await walk(path)));
    else if (item.name !== "sw.js") out.push(path);
  }
  return out;
}
const files = (await walk("dist")).sort(),
  h = createHash("sha256");
for (const f of files) h.update(await readFile(f));
const worker = await readFile("scripts/offline-worker.js", "utf8");
h.update(worker);
const cache = "turnmill-" + h.digest("hex").slice(0, 14);
const paths = files.map((file) => "./" + file.slice(5));
await writeFile(
  "dist/sw.js",
  "const cache=" +
    JSON.stringify(cache) +
    ", paths=" +
    JSON.stringify(paths) +
    ";\n" +
    worker,
);
