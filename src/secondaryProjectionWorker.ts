import init from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import {
  prepareDrawing,
  type DrawingSource,
  type PreparedDrawing,
  type DrawingCut,
} from "./preparedDrawing";
import type { SectionPlaneSpec } from "./secondaryProjection";

const ready = init({ locateFile: () => wasmUrl }).then(setOC);
let drawing: PreparedDrawing | undefined;
// Revisited planes (including Undo) reuse their exact section only within this source.
const recentCuts = new Map<string, DrawingCut>();
type Request =
  | { type: "prepare"; source: DrawingSource }
  | { type: "section"; id: number; plane?: SectionPlaneSpec };
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    await ready;
    if (data.type === "prepare") {
      recentCuts.clear();
      drawing?.dispose();
      drawing = undefined;
      drawing = prepareDrawing(data.source);
      self.postMessage({ base: drawing.base });
    } else if (drawing) {
      const key = JSON.stringify(data.plane || null);
      const cut = recentCuts.get(key) ?? drawing.cut(data.plane);
      recentCuts.delete(key);
      recentCuts.set(key, cut);
      if (recentCuts.size > 4)
        recentCuts.delete(recentCuts.keys().next().value!);
      self.postMessage({ id: data.id, cut });
    }
  } catch (e) {
    const text = e instanceof Error ? e.message : "";
    self.postMessage({
      id: data.type === "section" ? data.id : undefined,
      error:
        text && !/wasm|Binding|BRep_|abort/i.test(text)
          ? text
          : "Could not project the finished solid. Check its feature history and rebuild the model.",
    });
  }
};
