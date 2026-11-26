import { useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Matrix4 } from "three";
import { Modal } from "./Dialogs";
import { evaluateModel } from "./buildModel";
import { mergeParts } from "./mergeParts";
import type { PartTab, Project } from "./types";
import type { KernelReply } from "./Viewport";

export type MergeSession = {
  project: Project;
  parts: PartTab[];
  keepId: string;
  assembly: boolean;
  poses?: Record<string, number[]>;
  drivers?: Record<string, number[]>;
  poseError?: string;
};

export default function MergePartsDialog({ session, onSave, onClose, onPosition }: {
  session: MergeSession;
  onSave: (next: Project, keepId: string) => void;
  onClose: () => void;
  onPosition: () => void;
}) {
  const { project, parts, poses } = session;
  const [keepId, setKeepId] = useState(session.keepId);
  const [toolId, setToolId] = useState(() => parts.find(p => p.id !== keepId)!.id);
  const [assembly, setAssembly] = useState(session.assembly);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      worker.current?.terminate();
    };
  }, []);
  function chooseKeep(id: string) {
    if (id === toolId) setToolId(keepId);
    setKeepId(id);
    setError("");
  }
  const posed = !!poses && Object.values(poses).some(matrix =>
    matrix.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-9));

  async function merge() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (assembly && (!poses || session.poseError)) throw Error(session.poseError || "Open the 3D assembly to position the parts.");
      const relativePose = poses && new Matrix4().fromArray(poses[keepId]).invert()
        .multiply(new Matrix4().fromArray(poses[toolId])).toArray();
      const identity = new Matrix4().toArray();
      const source = assembly && session.drivers
        ? { ...project, workspaces: { ...project.workspaces, jointPose: session.drivers } } : project;
      const next = mergeParts(source, keepId, toolId, (assembly && relativePose) || identity, relativePose);
      const { features } = await evaluateModel(next);
      if (!mounted.current) return;
      const start = features.findIndex(f => f.id === keepId && f.operation === "new");
      if (start < 0) throw Error("Restore the part you want to keep.");
      const end = features.findIndex((f, i) => i > start && f.operation === "new");
      const engine = new Worker(new URL("./kernel.ts", import.meta.url), {type: "module", name: "turnmill-merge"});
      worker.current = engine;
      const done = () => { engine.terminate(); worker.current = null; };
      engine.onerror = () => {
        if (!mounted.current) return;
        done(); setBusy(false); setError("The geometry engine stopped. Try the merge again.");
      };
      engine.onmessage = ({ data }: MessageEvent<KernelReply>) => {
        if (!mounted.current || (data.type !== "built" && data.type !== "error")) return;
        done();
        if (data.type === "error") { setBusy(false); setError(data.message); }
        else onSave(next, keepId);
      };
      engine.postMessage({ type: "build", revision: 1, features: features.slice(start, end < 0 ? undefined : end) });
    } catch (cause) {
      if (!mounted.current) return;
      worker.current?.terminate();
      worker.current = null;
      setError(cause instanceof Error ? cause.message : "The merge could not be built.");
      setBusy(false);
    }
  }
  const options = (list: PartTab[]) => list.map(p =>
    <option key={p.id} value={p.id}>{p.name}{parts.some(other => other.id !== p.id && other.name === p.name) ? " · " + (parts.indexOf(p) + 1) : ""}</option>);
  return <Modal title="Merge parts" onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); void merge(); }}>
      <p className="helper">Join two parts into one solid where they overlap or share a face.</p>
      <label>Keep part<select aria-label="Keep part" value={keepId} disabled={busy}
        onChange={e => chooseKeep(e.target.value)}>{options(parts)}</select></label>
      <label>Part to merge<select aria-label="Part to merge" value={toolId} disabled={busy}
        onChange={e => { setToolId(e.target.value); setError(""); }}>{options(parts.filter(p => p.id !== keepId))}</select></label>
      {posed && <label>Positions<select aria-label="Merge positions" disabled={busy}
        value={assembly ? "assembly" : "part"} onChange={e => { setAssembly(e.target.value === "assembly"); setError(""); }}>
        <option value="part">Part studio positions</option><option value="assembly">Assembly positions</option>
      </select></label>}
      <p className="helper">The result keeps the first part’s name and material. Both sets of dimensions still drive the solid.</p>
      {error && <p role="alert" className="error-text">{error}</p>}
      {error && /touch|overlap|contact|apart|share a face/i.test(error) && <button type="button" onClick={onPosition}>Position parts in Assembly</button>}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy && <LoaderCircle className="spin" size={14}/>}
          {busy ? "Checking union…" : "Merge parts"}</button>
      </div>
    </form>
  </Modal>;
}
