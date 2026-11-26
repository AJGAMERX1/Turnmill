import { singleExportFilename } from "./shopExport";
import type { DisplayAppearance } from "./metalAppearance";
import type { MenuAnchor } from "./ContextMenu";
import { observeGeometry } from "../tests/hook/observe";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { createStudio, type DonorFinish, type View } from "./studio";
import type { FinishBodySnapshot, PreviewSolid, RenderBody } from "./geometry";
import type { MeshChange } from "./modelBodies";
import type { EvaluatedFeature, Project } from "./types";
import { explodePen } from "./penExplode";
import type { EvaluatedFinish } from "./finishingTypes";
import type { GripStock } from "./gripBands";

type GripMeasurement = GripStock & {
  bodyId: string;
  featureId: string;
  beforeFinishId?: string;
  priorKey?: string;
  error?: string;
};

export type KernelStatus = {
  signature?: string;
  /** Geometry that actually produced the published solids and thread frames. */
  builtSignature?: string;
  gripStock?: GripMeasurement;
  threadFrames?: import("./threadMates").ThreadFrame[];
  fitSurfaces?: import("./fitSurfaces").FitSurface[][];
  capSurfaces?: import("./fitSurfaces").FitSurface[][];
  busy: boolean;
  error: string;
  volume: number;
  area: number;
  bodyProperties?: import("./materials").BodyProps[];
  center?: [number, number, number];
};
export type ExportRequest = {
  assembly?: import("./assemblyExport").AssemblyExport;
  bodyIndex?: number;
  bodyId?: string;
  id: number;
  format: "step" | "stl" | "3mf";
  name: string;
};
type Props = {
  signature?: string;
  features: EvaluatedFeature[];
  view: View;
  fitToken: number;
  exportRequest: ExportRequest | null;
  onExportResult: (id: number, error?: string) => void;
  readSolids: RefObject<import("./packageDownload").SnapshotReader | null>;
  appearances?: (DisplayAppearance | number)[];
  visibleBodyId?: string;
  photoMode?: boolean;
  explosion?: { project: Project; gap: number };
  donorFinishes?: Record<string, DonorFinish>;
  measureRefillFit?: boolean;
  measureCapSeats?: boolean;
  gripBodyId?: string;
  gripFeatureId?: string;
  gripBeforeFinishId?: string;
  gripPriorFinishes?: EvaluatedFinish[];
  placements?: Record<string, number[]>;
  ghostIds?: string[];
  writingCheck?: RefObject<import("./writingFitJob").WritingRequest | null>;
  savePhoto?: RefObject<(() => Promise<Blob>) | null>;
  onBodyContextMenu?: (anchor: MenuAnchor, bodyId: string | null) => void;
  onBodyPick?: (bodyId: string) => void;
  onStatus: (status: KernelStatus) => void;
  takeFinishBody?: () => FinishBodySnapshot | FinishBodySnapshot[] | undefined;
};
export type KernelReply = { revision: number } & (
  | ((
      | { type: "built"; meshes: RenderBody[]; previewBody?: PreviewSolid; checkedBodies?: FinishBodySnapshot[] }
      | { type: "updated"; keys: number[]; changes: MeshChange[] }
    ) & {
      volume: number;
      threadFrames?: import("./threadMates").ThreadFrame[];
      fitSurfaces?: import("./fitSurfaces").FitSurface[][];
      capSurfaces?: import("./fitSurfaces").FitSurface[][];
      area: number;
      bodyProperties: import("./materials").BodyProps[];
      center?: [number, number, number];
    })
  | {
      type: "exported";
      blob: Blob;
      format: "step" | "stl" | "3mf";
      id: number;
      name: string;
    }
  | { type: "error"; task: "build" | "export"; id?: number; message: string; capFit?: import("./capSizing").CapDepthFit }
);

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function Viewport({
  signature: inputSignature,
  features,
  view,
  fitToken,
  exportRequest, onExportResult, readSolids,
  onStatus,
  takeFinishBody,
  appearances = [], donorFinishes,
  visibleBodyId, photoMode = false, explosion, placements, ghostIds = [], savePhoto, writingCheck, measureRefillFit = false, measureCapSeats = false,
  gripBodyId, gripFeatureId, gripBeforeFinishId, gripPriorFinishes,
  onBodyContextMenu,
  onBodyPick,
}: Props) {
  const node = useRef<HTMLDivElement>(null);
  const engine = useRef<Worker | undefined>(undefined);
  const studio = useRef<ReturnType<typeof createStudio> | undefined>(undefined);
  const [selected, setSelected] = useState("");
  const [displayError, setDisplayError] = useState("");
  const status = useRef<KernelStatus>({
    busy: true,
    error: "",
    volume: 0,
    area: 0,
  });
  const cb = useRef(onStatus);
  cb.current = onStatus;
  const exportResult = useRef(onExportResult);
  exportResult.current = onExportResult;
  const revision = useRef(0),
    lastExport = useRef<number | undefined>(undefined);
  const presentation = useRef({ appearances, visibleBodyId, photoMode, explosion, placements, ghostIds, donorFinishes, onBodyContextMenu, onBodyPick });
  presentation.current = { appearances, visibleBodyId, photoMode, explosion, placements, ghostIds, donorFinishes, onBodyContextMenu, onBodyPick };
  const gripFeature = gripFeatureId ?? gripBodyId;
  const gripPriorKey = JSON.stringify(gripPriorFinishes);
  const gripTarget = useRef({ gripBodyId, gripFeature, gripBeforeFinishId, gripPriorFinishes, gripPriorKey });
  gripTarget.current = { gripBodyId, gripFeature, gripBeforeFinishId, gripPriorFinishes, gripPriorKey };
  const builtRevision = useRef(-1);
  function requestGrip() {
    const target = gripTarget.current;
    if (!target.gripBodyId || builtRevision.current !== revision.current) return;
    engine.current?.postMessage({
      type: "grip-stock", revision: revision.current, bodyId: target.gripBodyId,
      featureId: target.gripFeature, beforeFinishId: target.gripBeforeFinishId, priorFinishes: target.gripPriorFinishes,
    });
  }
  const showing = useRef<string[]>([]);
  const building = useRef<string[]>([]);
  const installed = useRef<{ ids: string[]; meshes: RenderBody[] }>({ ids: [], meshes: [] });
  const photographed = useRef(false);
  const previouslyPosed = useRef(false);
  const previousGap = useRef<number | undefined>(undefined);
  const restoreAssembledFraming = useRef<(() => void) | undefined>(undefined);
  function presentBodies(reframe: boolean) {
    const { photoMode: on, explosion: layout, placements: pose, ghostIds: ghost, donorFinishes: donors } = presentation.current;
    if (on || photographed.current)
      studio.current?.setProductView(on, showing.current.map(id => ghost.includes(id)), showing.current.map(id => donors?.[id]));
    if (!pose && !previouslyPosed.current && !on && !photographed.current) return;
    const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    const matrices = showing.current.map(id => pose?.[id] ?? identity);
    const renderer = studio.current;
    if (renderer) {
      const gapChanged = layout?.gap !== previousGap.current;
      if (layout && previousGap.current === undefined) restoreAssembledFraming.current = renderer.rememberFraming();
      const transforms = layout ? explodePen(layout.project, showing.current, renderer.localBounds(), matrices, layout.gap) : matrices;
      renderer.setTransforms(transforms, reframe || gapChanged || on !== photographed.current || !!pose !== previouslyPosed.current,
        gapChanged && on === photographed.current);
      if (!layout && gapChanged) {
        if (on) restoreAssembledFraming.current?.();
        restoreAssembledFraming.current = undefined;
      }
    }
    previousGap.current = layout?.gap;
    previouslyPosed.current = !!pose;
    photographed.current = on;
  }
  function displayInstalled(reframe = true) {
    const { visibleBodyId: scope, appearances: colors } = presentation.current;
    const { ids, meshes } = installed.current;
    const index = scope === undefined ? -1 : ids.indexOf(scope);
    showing.current = scope === undefined ? ids : index < 0 ? [] : [scope];
    studio.current?.updateMeshes(
      scope === undefined ? meshes : index < 0 ? [] : [meshes[index]],
      scope === undefined ? colors : index < 0 ? [] : [colors[index]],
    );
    presentBodies(reframe);
  }
  const signature = useMemo(
    () => inputSignature ?? JSON.stringify(features),
    [features, inputSignature],
  );
  const retained = useRef(new Map<number, RenderBody>());
  const activeBuild = useRef(false);
  const pendingBuild = useRef<{
    revision: number;
    features: EvaluatedFeature[];
    finishBody?: FinishBodySnapshot | FinishBodySnapshot[];
    measureRefillFit: boolean;
    measureCapSeats: boolean;
  } | null>(null);
  function dispatchBuild() {
    if (activeBuild.current || !pendingBuild.current || !engine.current) return;
    const job = pendingBuild.current;
    pendingBuild.current = null;
    activeBuild.current = true;
    building.current = job.features.filter((feature) => feature.operation === "new").map((feature) => feature.id);
    engine.current.postMessage({
      type: "build",
      ...job,
      retainedMeshes: [...retained.current.keys()],
    });
  }

  function publish(updates: Partial<KernelStatus>) {
    status.current = { ...status.current, ...updates };
    cb.current(status.current);
  }
  useEffect(() => {
    if (!node.current) return;
    try {
      studio.current = createStudio(node.current, (label, index) => {
        setSelected(label);
        const id = index === null ? undefined : showing.current[index];
        if (id !== undefined) presentation.current.onBodyPick?.(id);
      }, (anchor, index) => {
        const id = index === null ? null : showing.current[index];
        if (id !== undefined) presentation.current.onBodyContextMenu?.(anchor, id);
      });
      if (savePhoto) savePhoto.current = () => studio.current!.captureProduct();
    } catch {
      setDisplayError(
        "The 3D view needs WebGL 2. Enable hardware acceleration in your browser, then reload.",
      );
    }
    const worker = new Worker(new URL("./kernel.ts", import.meta.url), {
      type: "module",
      name: "turnmill-solid-modeler",
    });
    engine.current = worker;
    const pendingModelReads = new Set<(message: string) => void>();
    readSolids.current = (ids, signal) => new Promise((resolve, reject) => {
      signal.throwIfAborted();
      if (status.current.busy || status.current.error || revision.current !== builtRevision.current)
        throw Error("Wait for the model to finish rebuilding.");
      const channel = new MessageChannel(), started = revision.current;
      const finish = () => { channel.port1.close(); pendingModelReads.delete(fail); signal.removeEventListener("abort", cancel); };
      const fail = (message: string) => { finish(); reject(Error(message)); };
      const cancel = () => { finish(); reject(signal.reason); };
      pendingModelReads.add(fail);
      signal.addEventListener("abort", cancel, { once: true });
      channel.port1.onmessage = ({data}) => {
        if (started !== revision.current || data.error) { fail(data.error || "The project changed. Export again."); return; }
        finish(); resolve(data.snapshots);
      };
      worker.postMessage({ type: "export-solids", revision: started, ids, port: channel.port2 }, [channel.port2]);
    });
    if (writingCheck) writingCheck.current = job => new Promise((resolve, reject) => {
      if (status.current.busy || status.current.error || revision.current !== builtRevision.current) {
        reject(Error("Wait for the pen to finish rebuilding."));
        return;
      }
      const channel = new MessageChannel(), started = revision.current;
      const finish = () => { channel.port1.close(); pendingModelReads.delete(fail); };
      const fail = (message: string) => { finish(); reject(Error(message)); };
      pendingModelReads.add(fail);
      channel.port1.onmessage = ({data}) => {
        if (started !== revision.current) { fail("The pen changed. Check the writing fit again."); return; }
        if (data.error) { fail(data.error); return; }
        finish(); resolve(data.result);
      };
      worker.postMessage({ type: "writing-fit", revision: started, job, port: channel.port2 }, [channel.port2]);
    });
    if(import.meta.env.VITE_CAD_QA==="1") observeGeometry(worker,()=>revision.current);
    worker.onmessage = ({ data }: MessageEvent<KernelReply | { type: "grip-stock"; revision: number; stock: GripMeasurement }>) => {
      if (data.type === "grip-stock") {
        const target = gripTarget.current;
        const stock = data.stock;
        if (data.revision === revision.current && stock.bodyId === target.gripBodyId &&
          stock.featureId === target.gripFeature && stock.beforeFinishId === target.gripBeforeFinishId &&
          stock.priorKey === target.gripPriorKey) publish({ gripStock: stock });
        return;
      }
      const buildReply =
        data.type === "updated" ||
        data.type === "built" ||
        (data.type === "error" && data.task === "build");
      if (buildReply) activeBuild.current = false;
      if (data.revision !== revision.current) {
        if ((data.type === "exported" || data.type === "error") && data.id !== undefined)
          exportResult.current(data.id, "The project changed during export.");
        // The worker may have installed this superseded build. The pending job
        // advertises only meshes actually retained by this viewport.
        dispatchBuild();
        return;
      }
      if (buildReply) {
        builtRevision.current = data.revision;
        requestGrip();
      }
      if (data.type === "updated" || data.type === "built") {
        if (data.type === "updated") {
          const available = retained.current;
          for (const { key, mesh } of data.changes) available.set(key, mesh);
          const next = new Map(
            data.keys.map((key) => [key, available.get(key)!]),
          );
          retained.current = next;
          installed.current = { ids: building.current, meshes: [...next.values()] };
        } else {
          retained.current.clear();
          installed.current = { ids: building.current, meshes: data.meshes };
        }
        displayInstalled();
        publish({
          busy: false,
          error: "",
          volume: data.volume,
          area: data.area,
          builtSignature: status.current.signature,
          threadFrames: data.threadFrames,
          fitSurfaces: data.fitSurfaces,
          capSurfaces: data.capSurfaces,
          bodyProperties: data.bodyProperties,
          center: data.center,
        });
      } else if (data.type === "exported") {
        download(data.blob, singleExportFilename(data.name, data.format));
        exportResult.current(data.id);
        publish({ busy: false, error: "" });
      } else if (data.task === "export") {
        if (data.id !== undefined) exportResult.current(data.id, data.message);
        publish({ busy: false });
      } else {
        retained.current.clear();
        installed.current = { ids: [], meshes: [] };
        displayInstalled();
        publish({
          builtSignature: undefined,
          threadFrames: undefined,
          volume: 0,
          area: 0,
          center: undefined,
          bodyProperties: [],
        });
        publish({ busy: false, error: data.message });
      }
    };
    worker.onerror = () => {
      if (lastExport.current !== undefined) exportResult.current(lastExport.current, "The export engine stopped.");
      for (const fail of pendingModelReads) fail("The solid modeler stopped during the request.");
      retained.current.clear();
      activeBuild.current = false;
      pendingBuild.current = null;
      installed.current = { ids: [], meshes: [] };
      displayInstalled();
      publish({
        busy: false,
        gripStock: undefined,
        builtSignature: undefined,
        threadFrames: undefined,
        error:
          "The CAD engine stopped. Reload to reopen the autosaved project.",
        volume: 0,
        area: 0,
        center: undefined,
        bodyProperties: [],
      });
    };
    return () => {
      if(import.meta.env.VITE_CAD_QA==="1") observeGeometry();
      for (const fail of pendingModelReads) fail("The model view was closed.");
      if (writingCheck) writingCheck.current = null;
      readSolids.current = null;
      if (lastExport.current !== undefined) exportResult.current(lastExport.current, "Export was interrupted.");
      worker.terminate();
      engine.current = undefined;
      retained.current.clear();
      activeBuild.current = false;
      pendingBuild.current = null;
      studio.current?.dispose();
      studio.current = undefined;
      if (savePhoto) savePhoto.current = null;
    };
  }, []);
  useEffect(() => {
    const current = ++revision.current;
    publish({ signature, busy: true, error: "", gripStock: undefined });
    pendingBuild.current = {
      revision: current,
      features,
      finishBody: takeFinishBody?.(),
      measureRefillFit, measureCapSeats,
    };
    dispatchBuild();
  }, [signature, measureRefillFit, measureCapSeats]);
  useEffect(() => {
    if (status.current.gripStock) publish({ gripStock: undefined });
    requestGrip();
  }, [gripBodyId, gripFeature, gripBeforeFinishId, gripPriorKey]);
  useEffect(() => {
    displayInstalled(false);
  }, [visibleBodyId, JSON.stringify(appearances)]);
  useEffect(() => { presentBodies(false); }, [photoMode, explosion?.project, explosion?.gap, JSON.stringify(placements), ghostIds.join(","), JSON.stringify(donorFinishes)]);
  useEffect(() => { studio.current?.fit(); }, [visibleBodyId]);
  useEffect(() => {
    studio.current?.setView(view);
  }, [view]);
  useEffect(() => {
    studio.current?.fit();
  }, [fitToken]);
  useEffect(() => {
    if (!exportRequest || lastExport.current === exportRequest.id) return;
    lastExport.current = exportRequest.id;
    publish({ busy: true, error: "" });
    engine.current?.postMessage({
      type: "export",
      revision: revision.current,
      ...exportRequest,
    });
  }, [exportRequest]);
  return (
    <div
      className="solid-viewport"
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        position: "relative",
      }}
    >
      <div ref={node} style={{ position: "absolute", inset: 0 }} />
      {(displayError || (!photoMode && selected)) && (
        <div
          role="status"
          style={{
            position: "absolute",
            bottom: 48,
            left: 18,
            font: "11px system-ui",
            borderRadius: 5,
            border: "1px solid #475456",
            background: "#1d2529",
            color: "#c5d4d2",
            padding: "6px 9px",
            pointerEvents: "none",
          }}
        >
          {displayError || selected}
        </div>
      )}
    </div>
  );
}

export default Viewport;
