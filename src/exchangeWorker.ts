import initOC from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import type { EvaluatedFeature } from "./types";
import { importSolidFile } from "./exchangeSolids";
import type { FileUnit, StoredBody } from "./exchangeTypes";

export type SolidImportRequest = {
  file: File;
  format: "step" | "stl";
  unit: FileUnit;
} | { format: "turnmill"; features: EvaluatedFeature[] };
export type SolidImportReply = { bodies: StoredBody[] } | { error: string };
const worker = self as unknown as DedicatedWorkerGlobalScope;
const ready = initOC({ locateFile: () => wasmUrl }).then(setOC);
worker.onmessage = async ({ data }: MessageEvent<SolidImportRequest>) => {
  try {
    await ready;
    if (data.format === "turnmill") {
      const { buildBodies, releaseBodies } = await import("./geometry");
      const shapes = buildBodies(data.features);
      try {
        const bodies = shapes.map(body => ({ name: body.name, brep: body.shape.serialize() }));
        worker.postMessage({ bodies } satisfies SolidImportReply);
      } finally { releaseBodies(shapes); }
      return;
    }
    const name =
      data.file.name.replace(/\.(step|stp|stl)$/i, "") || "Imported body";
    const shapes = await importSolidFile(
      data.format,
      data.file,
      name,
      data.unit,
    );
    try {
      const bodies = shapes.map((body) => ({
        name: body.name,
        brep: body.shape.serialize(),
      }));
      if (!bodies.length)
        throw new Error("This file contains no closed solid bodies.");
      worker.postMessage({ bodies } satisfies SolidImportReply);
    } finally {
      shapes.forEach((b) => b.shape.delete());
    }
  } catch (e) {
    worker.postMessage({
      error:
        e instanceof Error
          ? e.message
          : "The CAD engine could not read this file.",
    } satisfies SolidImportReply);
  }
};
