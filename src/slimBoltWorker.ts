import initOC from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import type { Project } from "./types";
import type { SlimSettings } from "./slimSizing";
import { previewSlimBolt } from "./slimBoltPen";

const ready = initOC({ locateFile: () => wasmUrl }).then(setOC);
self.onmessage = async ({ data }: { data: { project: Project; settings: SlimSettings } }) => {
  try {
    await ready;
    self.postMessage({ result: await previewSlimBolt(data.project, data.settings) });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : "The bolt assembly could not be measured. Restore its geometry and retry." });
  }
};
