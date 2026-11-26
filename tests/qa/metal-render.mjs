import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CylinderGeometry } from "three";
import { build } from "vite";
import { openBrowser } from "./browser.mjs";
import { serveBuild } from "./serve.mjs";

// Run the production shader and PNG capture on the same pen blank for each finish.
// Equal PBR settings isolate the actual grain from differences in overall gloss.
const directory = await mkdtemp(join(tmpdir(), "turnmill-metal-render-"));
let server, browser;
try {
  await build({ configFile: false, logLevel: "error", build: {
    outDir: directory, lib: { entry: { studio: resolve("src/studio.ts"), surfaces: resolve("src/metalAppearance.ts") },
      formats: ["es"], fileName: (_, name) => name + ".js" }, minify: true,
  } });
  await writeFile(join(directory, "index.html"), '<div id="viewport" style="width:900px;height:300px"></div>');
  server = await serveBuild("/qa/", directory);
  browser = await openBrowser();
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", e => failures.push(String(e)));
  page.on("console", m => { if (m.type() === "error") failures.push(m.text()); });
  await page.goto(server.url);
  const blank = new CylinderGeometry(6, 6, 70, 100).rotateZ(Math.PI / 2);
  const geometry = { vertices: Array.from(blank.attributes.position.array), normals: Array.from(blank.attributes.normal.array),
    triangles: Array.from(blank.index.array) };
  blank.dispose();
  const result = await page.evaluate(async ({ vertices, normals, triangles }) => {
    const { createStudio } = await import("./studio.js");
    const { appearanceForBody, setBodySurface } = await import("./surfaces.js");
    const studio = createStudio(document.getElementById("viewport"), () => {});
    const mesh = { vertices: Float32Array.from(vertices), normals: Float32Array.from(normals), triangles: Uint32Array.from(triangles),
      edges: new Float32Array(), faces: [{ start: 0, count: triangles.length, faceId: 0 }] };
    const project = { workspaces: { bodyMaterials: { blank: "Aluminum", cap: "Brass" } } };
    const natural = appearanceForBody(project, "blank");
    studio.updateMeshes([mesh], [natural]);
    studio.setProductView(true, [false]);
    studio.fit();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    async function capture(appearance) {
      studio.setColors([appearance]);
      const bitmap = await createImageBitmap(await studio.captureProduct());
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    function changedPixels(a, b) {
      let count = 0;
      for (let i = 0; i < a.length; i += 4) {
        const difference = Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]);
        if (difference >= 6) count++;
      }
      return count;
    }
    try {
      const original = await capture(natural), surfaces = {};
      for (const finish of ["brushed", "turned", "bead-blasted"]) {
        surfaces[finish] = await capture({ ...natural, finish });
      }
      const dyed = setBodySurface(project, "blank", { anodize: "#167E7D", finish: "turned" });
      const blue = await capture(appearanceForBody(dyed, "blank"));
      return { width: canvas.width, comparisons: {
        brushed: changedPixels(original, surfaces.brushed), turned: changedPixels(original, surfaces.turned),
        blasted: changedPixels(original, surfaces["bead-blasted"]),
        brushVsBlast: changedPixels(surfaces.brushed, surfaces["bead-blasted"]),
        dyed: changedPixels(original, blue),
      }, restored: changedPixels(original, await capture(natural)),
        capUnchanged: appearanceForBody(dyed, "cap").color === appearanceForBody(project, "cap").color };
    } finally { studio.dispose(); }
  }, geometry);
  assert.deepEqual(failures, []);
  assert.equal(result.width, 1920);
  assert(result.capUnchanged);
  assert.equal(result.restored, 0, "Restoring the natural finish restores identical PNG pixels");
  for (const [name, count] of Object.entries(result.comparisons)) {
    assert(count > 1000, name + " should be visible in the captured PNG, changed " + count + " pixels");
  }
  console.log("Metal render passed", result.comparisons);
} finally {
  await browser?.close();
  server?.close();
  await rm(directory, { recursive: true, force: true });
}
