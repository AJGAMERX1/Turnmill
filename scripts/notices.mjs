import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
const all = new Map();
async function collect(name, path) {
  const p = JSON.parse(await readFile(join(path, "package.json"), "utf8")),
    key = p.name + "@" + p.version;
  if (all.has(key)) return;
  const files = (await readdir(path)).filter((f) =>
    /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(f),
  );
  const notices = [];
  for (const file of files) {
    if ((await stat(join(path, file))).isFile())
      notices.push(await readFile(join(path, file), "utf8"));
  }
  all.set(
    key,
    [
      key,
      p.license || "",
      typeof p.repository === "string" ? p.repository : p.repository?.url || "",
      ...notices,
    ].join("\n"),
  );
  for (const dep of Object.keys(p.dependencies || {})) {
    let local = join(path, "node_modules", dep);
    try {
      await stat(join(local, "package.json"));
    } catch {
      local = join("node_modules", dep);
    }
    await collect(dep, local);
  }
}
const manifest = JSON.parse(await readFile("package.json", "utf8"));
for (const dep of Object.keys(manifest.dependencies))
  await collect(dep, join("node_modules", dep));
const font = await readFile("public/engraving-font-license.txt", "utf8");
await writeFile(
  "public/third-party-notices.txt",
  [...all.values(), font].join(
    "\n\n----------------------------------------\n\n",
  ),
);
