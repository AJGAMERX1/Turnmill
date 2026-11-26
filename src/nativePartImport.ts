import { Matrix4 } from "three";
import { evaluateModel } from "./buildModel";
import { asBase64, type StoredBody } from "./exchangeTypes";
import type { SolidImportReply } from "./exchangeWorker";
import { defaultJoint, placementFromMatrix } from "./kinematics";
import { uid } from "./projects";
import { isRigidTransform } from "./rigidTransform";
import type { EvaluatedFeature, Feature, Project } from "./types";

function readNativeBodies(features: EvaluatedFeature[], signal: AbortSignal) {
  return new Promise<StoredBody[]>((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./exchangeWorker.ts", import.meta.url), { type: "module", name: "turnmill-native-import" });
    function dispose() {
      worker.terminate();
      signal.removeEventListener("abort", cancel);
    }
    function cancel() {
      dispose();
      reject(signal.reason);
    }
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<SolidImportReply>) => {
      dispose();
      if ("error" in data) reject(Error(data.error));
      else resolve(data.bodies);
    };
    worker.onerror = event => {
      dispose();
      reject(Error(event.message || "The geometry engine could not rebuild the saved parts."));
    };
    try { worker.postMessage({ format: "turnmill", features }); }
    catch (error) { dispose(); reject(error); }
  });
}

/** Insert independent solids with fresh document IDs. Opening the source file restores its editable feature histories. */
export async function insertNativeParts(current: Project, source: Project, file: File, signal: AbortSignal): Promise<Project> {
  signal.throwIfAborted();
  const { features } = await evaluateModel(source);
  const roots = features.filter(f => f.operation === "new");
  if (!roots.length) throw Error("This project has no active solid parts. Use Open project to work with its sketches and history.");
  const data = await asBase64(file);
  const bodies = await readNativeBodies(features, signal);
  signal.throwIfAborted();
  if (roots.length !== bodies.length) throw Error("The saved parts could not all be rebuilt. Open the source project and check its feature history.");

  const sourceId = uid();
  const added: Feature[] = bodies.map((body, index) => ({
    id: uid(), name: body.name, kind: "import", operation: "new", sourceId, sourceIndex: index,
    sketchId: "", amount: "0", suppressed: false,
  }));
  const workspaces: NonNullable<Project["workspaces"]> = { ...current.workspaces, bodyMaterials: { ...current.workspaces?.bodyMaterials } };
  const poses: Record<string, number[]> = {};
  const joints: Record<string, ReturnType<typeof defaultJoint>> = {};
  const densities: Record<string, string> = {};
  roots.forEach(({ id }, i) => {
    const newId = added[i].id, ws = source.workspaces;
    const pose = ws?.allPartsPose?.[id];
    if (isRigidTransform(pose)) {
      poses[newId] = pose.slice();
      joints[newId] = { ...defaultJoint(), floating: true, placement: placementFromMatrix(new Matrix4().fromArray(pose)) };
    }
    workspaces.bodyMaterials[newId] = ws?.bodyMaterials?.[id] ?? ws?.material ?? "Brass";
    const density = ws?.bodyDensities?.[id];
    if (density !== undefined) densities[newId] = density;
  });
  if (Object.keys(poses).length) {
    workspaces.allPartsPose = { ...workspaces.allPartsPose, ...poses };
    workspaces.joints = { ...workspaces.joints, ...joints };
  }
  if (Object.keys(densities).length) workspaces.bodyDensities = { ...workspaces.bodyDensities, ...densities };
  return { ...current, workspaces, features: [...current.features, ...added],
    importedFiles: [...(current.importedFiles ?? []), { id: sourceId, name: file.name, format: "turnmill", data, bodies }] };
}
