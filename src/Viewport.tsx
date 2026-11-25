import { observeGeometry } from "../tests/hook/observe";
import { useEffect, useMemo, useRef, useState } from "react";
import { createStudio, type View } from "./studio";
import type { RenderBody } from "./geometry";
import type { MeshChange } from "./modelBodies";
import type { EvaluatedFeature } from "./types";

export type KernelStatus = {
  signature?: string;
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
  appearances?: number[];
  onStatus: (status: KernelStatus) => void;
};
export type KernelReply = { revision: number } & (
  | ((
      | { type: "built"; meshes: RenderBody[] }
      | { type: "updated"; keys: number[]; changes: MeshChange[] }
    ) & {
      volume: number;
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
  | { type: "error"; task: "build" | "export"; message: string }
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
  exportRequest,
  onStatus,
  appearances = [],
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
  const revision = useRef(0),
    lastExport = useRef<number | undefined>(undefined);
  const colors = useRef(appearances);
  colors.current = appearances;
  const signature = useMemo(
    () => inputSignature ?? JSON.stringify(features),
    [features, inputSignature],
  );
  const retained = useRef(new Map<number, RenderBody>());
  const activeBuild = useRef(false);
  const pendingBuild = useRef<{
    revision: number;
    features: EvaluatedFeature[];
  } | null>(null);
  function dispatchBuild() {
    if (activeBuild.current || !pendingBuild.current || !engine.current) return;
    const job = pendingBuild.current;
    pendingBuild.current = null;
    activeBuild.current = true;
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
      studio.current = createStudio(node.current, setSelected);
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
    if(import.meta.env.VITE_CAD_QA==="1") observeGeometry(worker,()=>revision.current);
    worker.onmessage = ({ data }: MessageEvent<KernelReply>) => {
      const buildReply =
        data.type === "updated" ||
        data.type === "built" ||
        (data.type === "error" && data.task === "build");
      if (buildReply) activeBuild.current = false;
      if (data.revision !== revision.current) {
        // The worker may have installed this superseded build. The pending job
        // advertises only meshes actually retained by this viewport.
        dispatchBuild();
        return;
      }
      if (data.type === "updated" || data.type === "built") {
        if (data.type === "updated") {
          const available = retained.current;
          for (const { key, mesh } of data.changes) available.set(key, mesh);
          const next = new Map(
            data.keys.map((key) => [key, available.get(key)!]),
          );
          retained.current = next;
          studio.current?.updateMeshes([...next.values()]);
        } else {
          retained.current.clear();
          studio.current?.updateMeshes(data.meshes);
        }
        studio.current?.setColors(colors.current);
        publish({
          busy: false,
          error: "",
          volume: data.volume,
          area: data.area,
          bodyProperties: data.bodyProperties,
          center: data.center,
        });
      } else if (data.type === "exported") {
        const filename =
          data.name
            .replace(/[/\\:*?"<>|]/g, "-")
            .replace(/\.(step|stl|3mf)$/i, "") || "Part";
        download(data.blob, filename + "." + data.format);
        publish({ busy: false, error: "" });
      } else {
        if (data.task === "build") {
          retained.current.clear();
          studio.current?.updateMeshes([]);
          publish({
            volume: 0,
            area: 0,
            center: undefined,
            bodyProperties: [],
          });
        }
        publish({ busy: false, error: data.message });
      }
    };
    worker.onerror = () => {
      retained.current.clear();
      activeBuild.current = false;
      pendingBuild.current = null;
      studio.current?.updateMeshes([]);
      publish({
        busy: false,
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
      worker.terminate();
      engine.current = undefined;
      retained.current.clear();
      activeBuild.current = false;
      pendingBuild.current = null;
      studio.current?.dispose();
      studio.current = undefined;
    };
  }, []);
  useEffect(() => {
    const current = ++revision.current;
    publish({ signature, busy: true, error: "" });
    pendingBuild.current = { revision: current, features };
    dispatchBuild();
  }, [signature]);
  useEffect(() => {
    studio.current?.setColors(colors.current);
  }, [appearances.join(",")]);
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
      {(displayError || selected) && (
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
