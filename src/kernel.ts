import initOC from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import { exportBodies, type RenderBody } from "./geometry";
import { ModelBodies } from "./modelBodies";
import type { EvaluatedFeature } from "./types";

const worker = self as unknown as DedicatedWorkerGlobalScope;
const ready = initOC({ locateFile: () => wasmUrl }).then(setOC);
const model = new ModelBodies();
let currentRevision = -1;

type Request =
  | {
      type: "build";
      revision: number;
      features: EvaluatedFeature[];
      retainedMeshes?: number[];
    }
  | {
      type: "export";
      bodyIndex?: number;
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
    if (data.type === "build") {
      currentRevision = -1;
      const { changes, keys, ...properties } = model.build(
        data.features,
        data.retainedMeshes,
      );
      const meshes = changes.map((change) => change.mesh);
      // One-shot preview workers receive the complete mesh list, as before.
      const output =
        data.retainedMeshes === undefined
          ? { type: "built", meshes }
          : { type: "updated", keys, changes };
      worker.postMessage(
        { ...output, revision: data.revision, ...properties },
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
    const blob = exportBodies(selected, data.format);
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
