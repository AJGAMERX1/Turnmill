import initOC from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import { buildBodies, releaseBodies, restoreFinishBody, type Body, type FinishBodySnapshot } from "./geometry";
import { exportShopArchive } from "./shopArchive";
import { bodyHistories } from "./modelBodies";
import type { DeliveryRequest } from "./shopExport";
import type { EvaluatedFeature, Project } from "./types";

export type DeliveryJob = { project: Project; features: EvaluatedFeature[]; request: DeliveryRequest; snapshots: FinishBodySnapshot[] };
export type DeliveryReply = { progress: string } | { blob: Blob } | { error: string };

self.onmessage = async ({ data }: MessageEvent<DeliveryJob>) => {
  const bodies: Body[] = [];
  try {
    await initOC({ locateFile: () => wasmUrl }).then(setOC);
    for (const history of bodyHistories(data.features)) {
      const root = history[0];
      const snapshot = data.snapshots.find(s => s.bodyId === root.id);
      const restored = snapshot?.history === JSON.stringify(history) ? restoreFinishBody(snapshot, root.name) : undefined;
      bodies.push(restored ?? buildBodies(history)[0]);
    }
    const blob = await exportShopArchive(data.project, bodies, data.features, data.request, progress => self.postMessage({ progress }));
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "The package could not be generated." });
  } finally { releaseBodies(bodies); }
};
