import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";
import { exportBodies, type Body } from "./geometry";
import { shopManifest, shopStepFilename, type ShopPackage } from "./shopExport";
import type { EvaluatedFeature } from "./types";

export async function exportShopArchive(bodies: Body[], features: EvaluatedFeature[], selection: ShopPackage) {
  const roots = features.filter(f => f.operation === "new");
  if (roots.length !== bodies.length || !selection.parts.length) throw Error("Choose at least one rebuilt part for the shop package.");
  const files: Record<string, Uint8Array> = {};
  const ids = new Set<string>();
  // Produce every STEP while the model revision still owns its kernel objects.
  const entries = selection.parts.map(part => {
    const index = roots.findIndex(f => f.id === part.bodyId);
    if (index < 0 || ids.has(part.bodyId)) throw Error("The part list changed. Reopen CNC shop package.");
    ids.add(part.bodyId);
    const filename = shopStepFilename(part);
    if (Object.hasOwn(files, filename)) throw Error("The parts have duplicate item numbers. Reopen the shop package.");
    files[filename] = new Uint8Array();
    const start = features.indexOf(roots[index]);
    const end = index + 1 < roots.length ? features.indexOf(roots[index + 1]) : features.length;
    return { part, filename, features: features.slice(start, end), frames: bodies[index].threadFrames ?? [],
      step: exportBodies([bodies[index]], "step") };
  });
  await Promise.all(entries.map(async entry => {
    if (!entry.step.size) throw Error("The STEP file for " + entry.part.name + " is empty.");
    files[entry.filename] = new Uint8Array(await entry.step.arrayBuffer());
  }));
  files["Shop manifest.txt"] = strToU8(shopManifest(selection.projectName, entries));
  const buffer = zipSync(files, { level: 4 });
  return new Blob([new Uint8Array(buffer)], { type: "application/zip" });
}
