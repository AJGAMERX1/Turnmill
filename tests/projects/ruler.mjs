import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { field, ready, sample, native, stepExport } from "./support.mjs";

export async function openLegacyRuler(page, fixture) {
  const path = resolve(fixture);
  const project = JSON.parse(await readFile(path, "utf8"));
  await field(page, "Open Turnmill project file").setInputFiles(path);
  await page.waitForFunction(async id => {
    try { return (await window.__cadTest.snapshot()).project.id === id; } catch { return false; }
  }, project.id);
  await ready(page);
  return project;
}

// The historical layout supplies reference contours for independent readers.
export async function legacyVectors(project, dir) {
  const vite = await createServer({
    configFile: false, server: { middlewareMode: true, hmr: false },
    appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { getScaleLayout } = await vite.ssrLoadModule("/src/secondaryEngraving.ts");
    const { makeScale, outlinedGraduations } = await vite.ssrLoadModule("/src/secondaryScale.ts");
    const { resolveParameters } = await vite.ssrLoadModule("/src/expressions.ts");
    const { svgFile, dxfFile } = await vite.ssrLoadModule("/src/secondaryVector.tsx");
    const layout = getScaleLayout(project.workspaces.scale, resolveParameters(project.parameters));
    const outlines = outlinedGraduations(makeScale(layout).geometry, layout);
    await Promise.all([
      writeFile(join(dir, "ruler.svg"), svgFile(outlines)),
      writeFile(join(dir, "ruler.dxf"), dxfFile(outlines)),
    ]);
  } finally { await vite.close(); }
}

export async function ruler(s) {
  // This unmodified v1 project exercises a graduation at the end face.
  const project = await openLegacyRuler(s.page, "test-evidence/phase2/projects/ruler/graduated-ruler.turnmill");
  await legacyVectors(project, s.dir);
  const svg = await readFile(join(s.dir, "ruler.svg"), "utf8");
  assert.match(svg, /width="155\.075mm"/);
  assert.match(svg, /height="22mm"/);
  const polys = [...svg.matchAll(/<polygon\b[^>]*>/g)]
    .filter(([tag]) => tag.includes("Graduation_outlines"))
    .map(([tag]) => {
      const points = tag
        .match(/points="([^"]+)"/)[1]
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number));
      return points.reduce(
        (a, [x, y]) => [a[0] + x / points.length, a[1] + y / points.length],
        [0, 0],
      );
    });
  const top = polys
      .filter(([x, y]) => y < 11)
      .map(([x]) => x)
      .sort((a, b) => a - b),
    bottom = polys
      .filter(([x, y]) => y > 11)
      .map(([x]) => x)
      .sort((a, b) => a - b);
  assert.equal(top.length, 154);
  assert.equal(bottom.length, 97);
  assert.equal(top.at(-1), 155);
  assert.equal(top.at(-1) - top.at(-2), 1);
  assert(Math.abs(top[150] - top[0] - 150) < 0.01);

  assert(Math.abs(bottom.at(-1) - bottom[0] - 152.4) < 0.01);
  const x = await sample(s, "01-legacy-aluminum-stock");
  assert.equal(x.bodies.length, 1);
  assert(x.volume > 0 && x.volume < 155 * 22 * 2);
  assert(Math.abs(x.mass - x.volume * 0.0027) < 0.001);
  await native(s, "graduated-ruler");
  await stepExport(s, "graduated-ruler");
}
