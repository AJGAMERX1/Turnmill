import { inspectBodies } from "../tests/hook/metrics";
import initOC from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import {
  exportBodies,
  type FinishBodySnapshot,
  type PreviewSolid,
  type RenderBody,
} from "./geometry";
import { exportAssemblyBodies } from "./assemblyExport";
import { ModelBodies } from "./modelBodies";
import { collectFitSurfaces, type FitSurface } from "./fitSurfaces";
import type { Shape3D } from "replicad";
import type { EvaluatedFeature } from "./types";

const worker = self as unknown as DedicatedWorkerGlobalScope;
const ready = initOC({ locateFile: () => wasmUrl }).then(setOC);
const model = new ModelBodies();
const fitCache = new WeakMap<Shape3D, FitSurface[]>();
const MIN_PREVIEW_SNAPSHOT_MS = 1000;
let currentRevision = -1;

type Request =
  | {type:"inspect-qa";revision:number;port:MessagePort}
  | {
      type: "build";
      revision: number;
      features: EvaluatedFeature[];
      retainedMeshes?: number[];
      measureRefillFit?: boolean;
      previewBodyIndex?: number;
      finishBody?: FinishBodySnapshot;
    }
  | {
      type: "export";
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
    await ready;
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
      currentRevision = -1;
      const started = performance.now();
      const { changes, keys, ...properties } = model.build(
        data.features,
        data.retainedMeshes,
        data.finishBody,
      );
      const meshes = changes.map((change) => change.mesh);
      // One-shot preview workers receive the complete mesh list, as before.
      const output =
        data.retainedMeshes === undefined
          ? { type: "built", meshes }
          : { type: "updated", keys, changes };
      // Only finish preview workers return editable geometry. Ordinary viewport
      // rebuilds, exports and inexpensive previews avoid serializing another copy.
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
      let fitSurfaces: FitSurface[][] | undefined;
      if (data.measureRefillFit) {
        const roots = data.features.filter(f => f.operation === "new");
        fitSurfaces = solids.map(({ shape }, i) => {
          const cached = fitCache.get(shape);
          if (cached) return cached;
          const lands = collectFitSurfaces(shape, roots[i].id, true);
          fitCache.set(shape, lands);
          return lands;
        });
      }
      worker.postMessage(
        { ...output, revision: data.revision, previewBody, ...properties, fitSurfaces, threadFrames: solids.flatMap((b) => b.threadFrames ?? []) },
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
    const blob = data.assembly
      ? exportAssemblyBodies(selected, data.format, data.assembly)
      : exportBodies(selected, data.format);
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
      message:
        error instanceof Error
          ? error.message
          : "The CAD engine could not finish. Check the sketch and retry.",
    });
  }
};
