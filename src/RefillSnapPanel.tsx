import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Magnet, Unlock } from "lucide-react";
import type { Matrix4 } from "three";
import type { Project, EvaluatedFeature } from "./types";
import type { FitSurface } from "./fitSurfaces";
import { evaluate } from "./expressions";
import { isSleeveDonor, refillComponents, type RefillComponent } from "./refills";
import { refillOpenings, refillSnapClearance, seatRefill, type RefillBodyBounds } from "./refillSeating";
import { canSnapRefill, makeRefillSnapJoint } from "./assemblyRefillSnap";
import type { Joint, JointConfig } from "./kinematics";

type Props = {
  project: Project;
  refill: RefillComponent;
  bodies: EvaluatedFeature[];
  surfaces: FitSurface[][];
  bounds: RefillBodyBounds[];
  config: JointConfig;
  values: Record<string, number>;
  ready: boolean;
  action: RefObject<HTMLButtonElement | null>;
  check: (refill: string, barrel: string, local: Matrix4) => Promise<void>;
  onSnap: (joint: Joint) => void;
  onRelease: () => void;
};
const mm = (n: number) => Number(n.toFixed(3)) + " mm";

export default function RefillSnapPanel({ project, refill, bodies, surfaces, bounds, config, values, ready,
  action, check, onSnap, onRelease }: Props) {
  const [choice, choose] = useState("");
  const [exposure, setExposure] = useState("2 mm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<Project | null>(project);
  active.current = project;
  useEffect(() => () => { active.current = null; }, []);
  const donor = isSleeveDonor(refill.kind);
  const joint = config[refill.bodyId];
  const snapped = joint?.refillSnap === true;
  const options = useMemo(() => {
    const refills = new Set(refillComponents(project).map(r => r.bodyId));
    const index = bodies.findIndex(b => b.id === refill.bodyId);
    const candidates = bodies.flatMap((b, i) => {
      if (refills.has(b.id) || !bounds[i] || !surfaces[i]) return [];
      return refillOpenings(surfaces[i], bounds[i]).map(opening => {
        let candidate: Joint | undefined, local: Matrix4 | undefined, problem = "";
        let clearance: number | undefined;
        try {
          local = seatRefill(project, refill.bodyId, opening, donor ? undefined : evaluate(exposure, values));
          candidate = makeRefillSnapJoint(config, refill.bodyId, b.id, local);
          const fit = refillSnapClearance(surfaces[index] || [], surfaces[i], local);
          clearance = fit?.clearance;
          if (fit && fit.clearance < 0) problem = "The Ø" + mm(fit.boreDiameter) + " bore is too small for the Ø"
            + mm(fit.refillDiameter) + " refill section. Choose a larger opening or resize the bore.";
        } catch (cause) { problem = (cause as Error).message; }
        const label = b.name + " · " + (opening.end === "start" ? "Start" : "End") + " · Ø" + mm(opening.diameter);
        return { opening, label, candidate, local, clearance, problem };
      });
    });
    const preferredEnd = refill.reversed ? "end" : "start";
    return candidates.sort((a, b) => Number(!!a.problem) - Number(!!b.problem)
      || Number(b.opening.end === preferredEnd) - Number(a.opening.end === preferredEnd));
  }, [project, refill, bodies, surfaces, bounds, config, values, donor, exposure]);
  const selected = options.find(o => o.opening.key === choice) ?? options[0];
  const parent = bodies.find(b => b.id === joint?.parent)?.name;
  async function snap() {
    if (!ready || busy || !selected?.candidate || !selected.local || selected.problem) return;
    setBusy(true);
    setError("");
    try {
      await check(refill.bodyId, selected.opening.bodyId, selected.local);
      if (active.current === project) onSnap(selected.candidate);
    } catch (cause) {
      if (active.current === project) setError((cause as Error).message);
    } finally { if (active.current) setBusy(false); }
  }
  if (!canSnapRefill(joint)) return <p className="refill-snap-note">This refill follows its assembly joint. Choose Free to seat it in another bore.</p>;
  const placement = <>
    <label>Bore opening<select aria-label="Bore opening" value={selected?.opening.key ?? ""} disabled={busy || !options.length}
      onChange={e => { choose(e.target.value); setError(""); }}>
      {!options.length && <option value="">No opening available</option>}
      {options.map((o, i) => <option key={o.opening.key} value={o.opening.key}>{o.label}
        {options.some((other, j) => j !== i && other.label === o.label) ? " · " + (i + 1) : ""}</option>)}
    </select></label>
    {!donor && <label>Tip exposure<input aria-label="Tip exposure" value={exposure} disabled={busy}
      onChange={e => { setExposure(e.target.value); setError(""); }}/></label>}
    {(error || selected?.problem) ? <p role="alert" className="error-text">{error || selected?.problem}</p>
      : <p className="refill-snap-note">{!ready ? "Waiting for assembly geometry…" : !selected
          ? "Add a barrel with a cylindrical opening at an end."
          : donor ? "The donor collar seats against the opening."
          : "Tip exposure is measured from the opening to the writing point."}
        {selected?.clearance !== undefined && " Diametral clearance " + mm(selected.clearance) + "."}</p>}
    <button type="button" ref={snapped ? undefined : action} className="outline-btn" disabled={!ready || busy || !selected || !!selected.problem}
      onClick={() => void snap()}><Magnet size={15}/>{busy ? "Checking fit…" : "Snap to fit"}</button>
  </>;
  return <section className="refill-snap-panel" aria-label="Refill fit">
    {snapped ? <>
      <p role="status">Seated in <strong>{parent}</strong></p>
      <button type="button" ref={action} className="outline-btn" onClick={onRelease} disabled={!ready || busy}><Unlock size={15}/>Release to free move</button>
      <details><summary>Adjust seat</summary>{placement}</details>
    </> : placement}
  </section>;
}
