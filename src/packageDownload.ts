import type { FinishBodySnapshot } from "./geometry";
import type { DeliveryJob, DeliveryReply } from "./deliveryWorker";
import type { DeliveryRequest } from "./shopExport";
import type { EvaluatedFeature, Project } from "./types";

export type SnapshotReader = (ids: string[], signal: AbortSignal) => Promise<FinishBodySnapshot[]>;

export async function packageDownload(project: Project, features: EvaluatedFeature[], request: DeliveryRequest,
  readSolids: SnapshotReader, progress: (text: string) => void, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  // Drawings use the complete parts list for saved sheet numbers and assembly references.
  const ids = new Set(request.parts.map(part => part.bodyId));
  let included = false;
  const needed = request.assemblyDrawing || request.drawings ? features : features.filter(feature => {
    if (feature.operation === "new") included = ids.has(feature.id);
    return included;
  });
  progress("Reading finished solids…");
  const snapshots = await readSolids(needed.filter(f => f.operation === "new").map(f => f.id), signal);
  signal.throwIfAborted();
  const job: DeliveryJob = { project, features: needed, request, snapshots };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./deliveryWorker.ts", import.meta.url), { type: "module", name: "turnmill-export" });
    const finish = () => { signal.removeEventListener("abort", cancel); worker.terminate(); };
    const cancel = () => { finish(); reject(signal.reason); };
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<DeliveryReply>) => {
      if ("progress" in data) { progress(data.progress); return; }
      finish();
      if ("error" in data) reject(Error(data.error));
      else resolve(data.blob);
    };
    worker.onerror = () => { finish(); reject(Error("The export engine stopped. Reopen Export and try again.")); };
    try { worker.postMessage(job); } catch (error) { finish(); reject(error); }
  });
}
