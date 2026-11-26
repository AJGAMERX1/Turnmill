import { inspectBodies } from "../tests/hook/metrics";
import initOC from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import {
  buildBodies,
  exportBodies,
  releaseBodies,
  type FinishBodySnapshot,
  type PreviewSolid,
  type RenderBody,
} from "./geometry";
import { exportAssemblyBodies } from "./assemblyExport";
import { ModelBodies } from "./modelBodies";
import { checkWritingGeometry } from "./writingFitWorker";
import { collectFitSurfaces, collectTurnedCapSurfaces, type FitSurface } from "./fitSurfaces";
import type { Shape3D } from "replicad";
import type { EvaluatedFeature, Project } from "./types";
import { verifyCapPosting } from "./capClearanceGeometry";
import { bodyIds } from "./kinematics";
import type { EvaluatedFinish } from "./finishingTypes";
import { measureGripStock, type GripStock } from "./gripBands";

const worker = self as unknown as DedicatedWorkerGlobalScope;
const ready = initOC({ locateFile: () => wasmUrl }).then(setOC);
const model = new ModelBodies();
const fitCache = new WeakMap<Shape3D, FitSurface[]>();
const capSurfaceCache = new WeakMap<Shape3D, FitSurface[]>();
const MIN_PREVIEW_SNAPSHOT_MS = 1000;
let currentRevision = -1;

type GripRequest = {
  type: "grip-stock";
  revision: number;
  bodyId: string;
  featureId: string;
  beforeFinishId?: string;
  priorFinishes?: EvaluatedFinish[];
};

let latestBuild: { revision: number; features: EvaluatedFeature[] } | undefined;
let lastGrip: { key: string; stock: GripStock } | undefined;

function gripStock(request: GripRequest): GripStock {
  if (request.revision !== latestBuild?.revision) throw Error("The part changed. Reopen Grip milling.");
  const { features } = latestBuild;
  const root = features.findIndex(f => f.id === request.bodyId && f.operation === "new");
  const end = features.findIndex(f => f.id === request.featureId);
  if (root < 0 || end < root || features.slice(root + 1, end + 1).some(f => f.operation === "new"))
    throw Error("Restore the selected feature to measure its grip surfaces.");

  const target = features[end], finishes = target.finishes ?? [];
  const before = request.beforeFinishId ? finishes.findIndex(f => f.id === request.beforeFinishId) : finishes.length;
  if (before < 0 && !request.priorFinishes) throw Error("Reopen the grip to measure its stock.");
  const prior = request.priorFinishes ?? finishes.slice(0, before);
  const prefix = { ...target, finishes: prior, advanced: undefined, operations: undefined, reverseRefillLength: undefined };
  const history = [...features.slice(root, end), prefix];
  const key = JSON.stringify(history);
  if (lastGrip?.key === key) return lastGrip.stock;

  const isCurrentSolid = currentRevision === request.revision &&
    (!features[end + 1] || features[end + 1].operation === "new") &&
    !target.advanced && !target.operations?.length && target.reverseRefillLength === undefined &&
    JSON.stringify(finishes) === JSON.stringify(prior);
  let stock: GripStock;
  if (isCurrentSolid) {
    const bodyIndex = features.slice(0, root).filter(f => f.operation === "new").length;
    stock = measureGripStock(model.bodies[bodyIndex].shape);
  } else {
    // Measure where this finish actually runs, before later cuts or transforms.
    const bodies = buildBodies(history);
    try { stock = measureGripStock(bodies[0].shape); }
    finally { releaseBodies(bodies); }
  }
  lastGrip = { key, stock };
  return stock;
}

type Request =
  | { type: "writing-fit"; revision: number; job: import("./writingFitJob").WritingJob; port: MessagePort }
  | GripRequest
  | { type: "export-solids"; revision: number; ids: string[]; port: MessagePort }
  | {type:"inspect-qa";revision:number;port:MessagePort}
  | {
      type: "build";
      revision: number;
      features: EvaluatedFeature[];
      retainedMeshes?: number[];
      measureRefillFit?: boolean;
      measureCapSeats?: boolean;
      capPostingCheck?: { project: Project; capId: string; fitCavityDepth?: number };
      previewBodyIndex?: number;
      finishBody?: FinishBodySnapshot | FinishBodySnapshot[];
      snapshotBodyIds?: string[];
    }
  | {
      type: "export";
      bodyId?: string;
      bodyIndex?: number;
      assembly?: import("./assemblyExport").AssemblyExport;
      revision: number;
      id: number;
      format: "step" | "stl" | "3mf";
      name: string;
    };

const buffers = (m: RenderBody) =>
  [
    m.vertices.buffer,
    m.normals.buffer,
    m.triangles.buffer,
    m.edges.buffer,
    ...(m.guides ? [m.guides.buffer] : []),
  ] as ArrayBuffer[];

worker.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    if (data.type === "grip-stock") {
      const { revision, bodyId, featureId, beforeFinishId, priorFinishes } = data;
      const source = { bodyId, featureId, beforeFinishId, priorKey: JSON.stringify(priorFinishes) };
      try {
        await ready;
        worker.postMessage({ type: "grip-stock", revision, stock: { ...source, ...gripStock(data) } });
      } catch (error) {
        worker.postMessage({ type: "grip-stock", revision, stock: {
          ...source, minX: 0, maxX: 0, bands: [],
          error: error instanceof Error ? error.message : "The grip surfaces could not be measured.",
        } });
      }
      return;
    }
    if (data.type === "export-solids") {
      try {
        await ready;
        if (currentRevision !== data.revision || currentRevision < 0)
          throw Error("The model changed. Wait for the rebuild and export again.");
        data.port.postMessage({ snapshots: model.snapshots(data.ids) });
      } catch (error) {
        data.port.postMessage({ error: error instanceof Error ? error.message : "The solids could not be read." });
      } finally { data.port.close(); }
      return;
    }
    await ready;
    if (data.type === "writing-fit") {
      try {
        if (currentRevision < 0 || data.revision !== currentRevision || latestBuild?.revision !== currentRevision)
          throw Error("The pen changed. Wait for the rebuild and check the fit again.");
        data.port.postMessage({ result: checkWritingGeometry(data.job, model.bodies, latestBuild.features) });
      } catch (cause) {
        data.port.postMessage({ error: cause instanceof Error ? cause.message : "The solid modeler could not check this fit." });
      } finally { data.port.close(); }
      return;
    }
    if (data.type === "inspect-qa") {
      if (import.meta.env.VITE_CAD_QA === "1") {
        try {
          if (currentRevision!==data.revision || currentRevision<0) throw Error("The exact model is still rebuilding.");
          data.port.postMessage({bodies:inspectBodies(model.bodies)});
        } catch (e) {data.port.postMessage({error:String(e)});} finally {data.port.close();}
      }
      return;
    }

    if (data.type === "build") {
      latestBuild = { revision: data.revision, features: data.features };
      currentRevision = -1;
      const started = performance.now();
      const { changes, keys, ...properties } = model.build(
        data.features,
        data.retainedMeshes,
        data.finishBody,
        data.snapshotBodyIds === undefined,
      );
      const meshes = changes.map((change) => change.mesh);
      // One-shot preview workers receive the complete mesh list, as before.
      const output =
        data.retainedMeshes === undefined
          ? { type: "built", meshes }
          : { type: "updated", keys, changes };
      // A preview can return its validated solid for reuse when the edit is committed.
      let previewBody: PreviewSolid | undefined;
      if (
        data.previewBodyIndex !== undefined &&
        performance.now() - started >= MIN_PREVIEW_SNAPSHOT_MS
      ) {
        const body = model.bodies[data.previewBodyIndex];
        if (body) {
          try {
            previewBody = {
              brep: body.shape.serialize(),
              volume: properties.bodyProperties[data.previewBodyIndex].volume,
              guides: body.guides,
              threadFrames: body.threadFrames,
            };
          } catch {
            // A successful preview can still be applied by a normal history rebuild.
          }
        }
      }
      const solids = model.bodies;
      if (data.capPostingCheck) {
        const { project, capId, fitCavityDepth } = data.capPostingCheck;
        const capFit = verifyCapPosting(project, capId, solids, bodyIds(data.features), fitCavityDepth);
        if (capFit) {
          worker.postMessage({ type: "error", task: "build", revision: data.revision, capFit,
            message: "The cap needs a deeper pocket for " + capFit.part + "." });
          return;
        }
      }
      let fitSurfaces: FitSurface[][] | undefined;
      let capSurfaces: FitSurface[][] | undefined;
      if (data.measureRefillFit || data.measureCapSeats) {
        const roots = data.features.filter(f => f.operation === "new");
        fitSurfaces = solids.map(({ shape }, i) => {
          const cached = fitCache.get(shape);
          if (cached) return cached;
          const lands = collectFitSurfaces(shape, roots[i].id, true);
          fitCache.set(shape, lands);
          return lands;
        });
        if (data.measureCapSeats) {
          const fits = fitSurfaces;
          capSurfaces = solids.map(({ shape }, i) => {
            if (roots[i].kind !== "revolve") return fits[i];
            const cached = capSurfaceCache.get(shape);
            if (cached) return cached;
            const seats = collectTurnedCapSurfaces(shape, roots[i].id, fits[i]);
            capSurfaceCache.set(shape, seats);
            return seats;
          });
        }
      }
      const checkedBodies = data.snapshotBodyIds && model.snapshots(data.snapshotBodyIds);
      worker.postMessage(
        { ...output, revision: data.revision, previewBody, checkedBodies, ...properties, fitSurfaces, capSurfaces, threadFrames: solids.flatMap((b) => b.threadFrames ?? []) },
        meshes.flatMap(buffers),
      );
      currentRevision = data.revision;
      return;
    }
    if (currentRevision !== data.revision || currentRevision < 0)
      throw new Error("Rebuild the current model before exporting.");
    const bodies = model.bodies;
    const selected =
      data.bodyIndex === undefined
        ? bodies
        : bodies.slice(data.bodyIndex, data.bodyIndex + 1);
    if (data.assembly) {
      const roots = latestBuild?.features.filter(f => f.operation === "new") ?? [];
      const start = data.bodyIndex ?? 0;
      if (data.assembly.ids.some((id, i) => id !== roots[start + i]?.id))
        throw Error("The assembly changed. Rebuild it before exporting.");
    }
    if (data.bodyId !== undefined && latestBuild?.features.filter(f => f.operation === "new")[data.bodyIndex ?? -1]?.id !== data.bodyId)
      throw Error("The selected part changed. Select it again before exporting.");
    const blob = data.assembly ? exportAssemblyBodies(selected, data.format, data.assembly) : exportBodies(selected, data.format);
    if (!blob.size)
      throw new Error(
        "The export produced an empty file. Check the model and try again.",
      );
    worker.postMessage({
      type: "exported",
      revision: data.revision,
      id: data.id,
      blob,
      name: data.name,
      format: data.format,
    });
  } catch (error) {
    worker.postMessage({
      type: "error",
      revision: data.revision,
      task: data.type,
      id: data.type === "export" ? data.id : undefined,
      message:
        error instanceof Error
          ? error.message
          : "The CAD engine could not finish. Check the sketch and retry.",
    });
  }
};
