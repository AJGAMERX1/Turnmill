import { useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Modal } from "./Dialogs";
import { evaluateModel } from "./buildModel";
import { threadPresets } from "./finishingTypes";
import type { FitSurface } from "./fitSurfaces";
import type { JointConfig } from "./kinematics";
import { partFeatures } from "./partTabs";
import { resolveThreadMates } from "./threadMates";
import { barrelAxis, barrelEnd, createThreadedCone, suggestedPairSize, type PairSettings } from "./threadedCone";
import type { Project } from "./types";
import type { KernelReply } from "./Viewport";
import "./threadsDialog.css";

type Props = {
  project: Project; bodyId: string; surfaces?: FitSurface[]; measurementError?: string;
  onSingle: () => void; onParameters: () => void; onEdit: (featureId: string, finishId: string) => void;
  onSave: (next: Project, id: string, showAssembly: boolean) => void; onClose: () => void;
};

function JointSection({ start, closed }: { start: boolean; closed: boolean }) {
  // Schematic longitudinal section. The cone and socket use contrasting materials.
  return <svg className="thread-pair-section" role="img" aria-label={`Section of cone screwed into the ${start ? "start" : "end"} of a barrel with an ${closed ? "enclosed" : "open"} back`}
    viewBox="0 0 320 64">
    <g transform={start ? "translate(320 0) scale(-1 1)" : undefined}>
      <path fill="#526c6f" stroke="#9eb8bb" d="M15 10H192V18l-4 3-4-3-4 3-4-3-4 3-4-3-4 3-4-3H15ZM15 54H192V46l-4-3-4 3-4-3-4 3-4-3-4 3-4-3-4 3H15Z"/>
      {closed && <path d="M15 18H23V46H15Z" fill="#526c6f" stroke="#9eb8bb"/>}
      <path fill="#987241" stroke="#edbc73" d="M161 26V22l3-3 4 3 4-3 4 3 4-3 4 3 4-3 4 3V10L300 26V29H161ZM161 38v4l3 3 4-3 4 3 4-3 4 3 4-3 4 3 4-3v12l108-16v-3H161Z"/>
    </g>
    <path d="M4 32H316" stroke="#81908d" strokeDasharray="6 4"/>
  </svg>;
}

export default function ThreadsDialog({ project, bodyId, surfaces, measurementError, onSingle, onParameters, onEdit, onSave, onClose }: Props) {
  const features = partFeatures(project, bodyId).filter(f => !f.suppressed);
  const root = features[0];
  const axis = barrelAxis(root, surfaces);
  const [end, setEnd] = useState<PairSettings["end"]>("end");
  const stock = surfaces && barrelEnd(surfaces, axis, end);
  const [requestedSize, setSize] = useState("");
  const size = requestedSize || (stock && suggestedPairSize(stock)) || "";
  const [length, setLength] = useState("4.5 mm"), [coneLength, setConeLength] = useState("15 mm");
  const [tipDiameter, setTip] = useState("4 mm"), [opening, setOpening] = useState("2.5 mm");
  const [closeBack, setCloseBack] = useState(false), [thickness, setThickness] = useState("2 mm");
  const [allowance, setAllowance] = useState("0.10 mm");
  const [mode, setMode] = useState<PairSettings["mode"]>("modeled");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const token = useRef(0), worker = useRef<Worker | null>(null);
  useLayoutEffect(() => () => { token.current++; worker.current?.terminate(); }, []);
  const existing = features.flatMap(feature => feature.finishes?.filter(f => f.kind === "thread")
    .map(f => ({ feature, finish: f })) ?? []);
  const connected = Object.entries((project.workspaces?.joints ?? {}) as JointConfig)
    .some(([id, joint]) => joint.threadMate && (id === bodyId || joint.parent === bodyId));
  async function create() {
    if (!stock || busy) return;
    setBusy(true); setError("");
    const request = ++token.current;
    try {
      const result = createThreadedCone(project, bodyId, stock, { end, size, length, coneLength, tipDiameter,
        opening, allowance, mode, ...(closeBack ? { backWall: thickness } : {}) });
      const next = result.project;
      // Check the two new mating solids, including the barrel's earlier machining.
      const history = next.features.filter(f => f.id === result.coneId || features.some(s => f.id === s.id));
      const model = await evaluateModel({ ...next, features: history });
      if (token.current !== request) return;
      const engine = new Worker(new URL("./kernel.ts", import.meta.url), { type: "module", name: "turnmill-thread-pair" });
      worker.current = engine;
      const finish = () => { engine.terminate(); worker.current = null; setBusy(false); };
      engine.onerror = () => { if (request !== token.current) return; finish(); setError("The geometry engine stopped. Try a shorter thread."); };
      engine.onmessage = ({ data }: MessageEvent<KernelReply>) => {
        if (request !== token.current || (data.type !== "built" && data.type !== "error")) return;
        finish();
        if (data.type === "error") { setError(data.message); return; }
        try {
          resolveThreadMates({ [result.coneId]: next.workspaces!.joints[result.coneId] }, data.threadFrames ?? [],
            model.values, [bodyId, result.coneId]);
          onSave(next, result.coneId, stock.axis !== "X" || stock.centerline.some(n => Math.abs(n) > 1e-6));
        } catch (cause) { setError((cause as Error).message); }
      };
      engine.postMessage({ type: "build", revision: 1, features: model.features });
    } catch (cause) {
      if (token.current !== request) return;
      worker.current?.terminate(); worker.current = null; setError((cause as Error).message); setBusy(false);
    }
  }
  function input(label: string, v: string, edit: (s: string) => void) {
    return <label>{label}<input aria-label={label} value={v} onChange={e => edit(e.target.value)}/></label>;
  }
  return <Modal title="Threads" onClose={onClose} className="thread-pair-dialog">
    <div className="thread-task"><strong>Create screw-on cone</strong><button type="button" onClick={onSingle} disabled={busy}>Thread one part</button></div>
    <p className="helper">Add a removable cone to {root?.name ?? "the barrel"}. Its threaded stem screws into a matching socket.</p>
    {connected && <button className="thread-shared" type="button" disabled={busy} onClick={onParameters}>Edit shared thread parameters</button>}
    {existing.length > 0 && <details><summary>Edit existing threads ({existing.length})</summary>
      {existing.map(({ feature, finish }) => <button key={finish.id} disabled={busy} type="button"
        onClick={() => onEdit(feature.id, finish.id)}>{finish.name} · {feature.name}</button>)}</details>}
    <JointSection start={end === "start"} closed={closeBack}/>
    <form onSubmit={e => { e.preventDefault(); void create(); }} onChange={() => setError("")}>
      <fieldset disabled={busy}>
        <div className="thread-pair-grid">
          <label>Barrel end<select aria-label="Barrel end" value={end} onChange={e => { setEnd(e.target.value as PairSettings["end"]); setSize(""); }}>
            <option value="start">Start · min {axis}</option><option value="end">End · max {axis}</option>
          </select></label>
          <label>Thread size<select aria-label="Thread size" value={size} onChange={e => setSize(e.target.value)}>
            {!size && <option value="">Choose size</option>}
            {threadPresets.map(p => <option key={p.label}>{p.label}</option>)}
          </select></label>
          {input("Thread length", length, setLength)}
          {input("Cone length", coneLength, setConeLength)}
          {input("Tip outside diameter", tipDiameter, setTip)}
          {input("Tip opening diameter", opening, setOpening)}
        </div>
        {stock && <p className="helper">Barrel Ø{Number(stock.outside.toFixed(3))} mm · {stock.bore > 0 ? "Bore Ø" + Number(stock.bore.toFixed(3)) + " mm" : "Solid end"}</p>}
        <label className="thread-close-back"><input type="checkbox" checked={closeBack}
          onChange={e => setCloseBack(e.target.checked)}/> Close back of barrel</label>
        {closeBack && input("Back wall thickness", thickness, setThickness)}
        <label>Thread geometry<select aria-label="Thread geometry" value={mode} onChange={e => setMode(e.target.value as PairSettings["mode"])}>
          <option value="modeled">Modeled · cut helical grooves</option><option value="cosmetic">Cosmetic · show thread guides</option>
        </select></label>
        <details><summary>Fit allowance</summary>
          {input("Diametral allowance", allowance, setAllowance)}
          <p className="helper">This reduces the cone’s thread diameter relative to the socket. Verify the fit for your material and process.</p>
        </details>
      </fieldset>
      {(error || measurementError) && <p role="alert" className="error-text">{error || measurementError}</p>}
      {!stock && !error && !measurementError && <p className="helper">{surfaces ? "Choose a barrel with a round axial end, or use Thread one part." : "Measuring the barrel ends…"}</p>}
      <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button>
        <button className="primary" type="submit" disabled={busy || !stock || !size || !!measurementError}>
          {busy && <LoaderCircle size={14} className="spin"/>}{busy ? "Checking both parts…" : "Create threaded cone"}
        </button></div>
    </form>
  </Modal>;
}
