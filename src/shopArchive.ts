import { strToU8, zipSync } from "three/examples/jsm/libs/fflate.module.js";
import { exportBodies, type Body } from "./geometry";
import { createPackageDrawings, type PackageDrawingRequest } from "./packageDrawings";
import { assemblyDrawingPath, shopManifest, shopPartsCsv, shopPaths, type DeliveryRequest } from "./shopExport";
import type { EvaluatedFeature, Project } from "./types";

export async function exportShopArchive(project: Project, bodies: Body[], features: EvaluatedFeature[], request: DeliveryRequest, progress: (message: string) => void) {
  const roots = features.filter(f => f.operation === "new");
  if (roots.length !== bodies.length) throw Error("The part list changed. Reopen Export.");
  if (!request.assemblyDrawing && !(request.parts.length && (request.models || request.printModels || request.drawings)))
    throw Error("Choose at least one model or drawing to export.");
  const ids = new Set<string>(), items = new Set<number>();
  const files: Record<string, Uint8Array> = Object.create(null);
  const drawings: PackageDrawingRequest[] = [];
  const entries = [];
  for (const part of request.parts) {
    const index = roots.findIndex(f => f.id === part.bodyId);
    if (index < 0 || ids.has(part.bodyId) || items.has(part.item)) throw Error("The part list changed. Reopen Export.");
    ids.add(part.bodyId);
    items.add(part.item);
    const body = bodies[index], paths = shopPaths(part);
    const start = features.indexOf(roots[index]);
    const end = index + 1 < roots.length ? features.indexOf(roots[index + 1]) : features.length;
    entries.push({ part, features: features.slice(start, end), frames: body.threadFrames ?? [] });
    for (const format of ["step", "3mf"] as const) {
      if (!(format === "step" ? request.models : request.printModels)) continue;
      const filename = format === "step" ? paths.model : paths.print;
      progress("Writing " + filename);
      try {
        const blob = exportBodies([body], format);
        if (!blob.size) throw Error("The model file is empty.");
        files[filename] = new Uint8Array(await blob.arrayBuffer());
      } catch (error) {
        throw Error(filename + " — " + (error instanceof Error ? error.message : String(error)));
      }
    }
    if (request.drawings) drawings.push({ bodyId: part.bodyId, filename: paths.drawing });
  }
  if (request.assemblyDrawing) drawings.push({ bodyId: null, filename: assemblyDrawingPath });
  Object.assign(files, await createPackageDrawings(project, features, drawings, (completed, total, name) => {
    if (completed < total) progress("Drawing " + (completed + 1) + " of " + total + " · " + name);
  }, bodies));
  files["Parts list.csv"] = strToU8(shopPartsCsv(request.parts, request));
  files["Shop manifest.txt"] = strToU8(shopManifest(project.name, entries, request));
  progress("Packing ZIP…");
  return new Blob([new Uint8Array(zipSync(files, { level: 4 }))], { type: "application/zip" });
}
