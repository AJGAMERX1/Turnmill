import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { evaluate } from "./expressions";
import type { FitSurface } from "./fitSurfaces";
import { diametralFit, refillBoreChecks } from "./refillClearance";
import { isSleeveDonor, type RefillComponent } from "./refills";
import type { EvaluatedFeature, Project } from "./types";

const format = (n: number) => n > 0 && n < 0.001 ? "<0.001" : String(Number(n.toFixed(3)));

function gapLabel({clearance, status}: ReturnType<typeof diametralFit>) {
  return status === "line-to-line" ? "Line-to-line · 0 mm clearance"
    : format(Math.abs(clearance)) + " mm " + (status === "interference" ? "interference" : "clearance");
}

type Props = {
  project: Project;
  commit: (p: Project) => void;
  installed: RefillComponent[];
  bodies: EvaluatedFeature[];
  surfaces?: FitSurface[][];
  matrices?: number[][];
  values: Record<string, number>;
};

const cartridgeSections = {body_diameter: "Tube", guide_diameter: "Tip guide", tail_diameter: "Tail"};
const sleeveSections = {shank_diameter: "Press-in shank", body_diameter: "Tube", collar_diameter: "Seating collar", guide_diameter: "Metal tip"};
type Section = keyof typeof cartridgeSections | keyof typeof sleeveSections;
type ManualCheck = {hole: string; section: Section};

function ManualDiameter({ project, commit, refill, values }: Pick<Props, "project" | "commit" | "values"> & {refill: RefillComponent}) {
  const saved = project.workspaces?.refillDiameterChecks?.[refill.bodyId];
  const hole = typeof saved?.hole === "string" ? saved.hole : "";
  const sleeve = isSleeveDonor(refill.kind);
  const sections: Partial<Record<Section, string>> = sleeve ? sleeveSections : cartridgeSections;
  const section: Section = Object.hasOwn(sections, saved?.section ?? "") ? saved.section : sleeve ? "shank_diameter" : "body_diameter";
  const [edit, setEdit] = useState<string | null>(null);
  const draft = edit ?? hole;
  const refillDiameter = values[refill.prefix + "_" + section];
  let inputError = "", diameter: number | undefined;
  if (draft.trim()) {
    try {
      const value = evaluate(draft, values);
      if (!(value > 0)) throw Error("Enter a hole diameter greater than zero.");
      diameter = value;
    } catch (e) { inputError = (e as Error).message; }
  }
  function save(next: ManualCheck) {
    if (next.hole === hole && next.section === section) return;
    commit({ ...project, workspaces: { ...project.workspaces, refillDiameterChecks: {
      ...project.workspaces?.refillDiameterChecks, [refill.bodyId]: next,
    } } });
  }
  const comparison = diameter !== undefined && Number.isFinite(refillDiameter) && refillDiameter > 0
    ? diametralFit(diameter, refillDiameter) : undefined;
  const tight = comparison && comparison.status !== "clearance";
  return <>
    <details className="manual-diameter"><summary>Check a hole diameter</summary>
      <label>Hole diameter<input aria-label="Hole diameter" placeholder="e.g. 5 mm" value={draft}
        spellCheck={false} onChange={(e) => setEdit(e.target.value)} onBlur={() => {
          if (edit !== null && !inputError) { save({ hole: edit.trim(), section }); setEdit(null); }
        }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setEdit(null); e.preventDefault(); } }}/></label>
      <label>Compare with<select aria-label="Refill diameter to check" value={section}
        onChange={(e) => save({hole, section: e.target.value as Section})}>
        {(Object.keys(sections) as Section[]).map((key) => <option key={key} value={key}>{sections[key]}</option>)}
      </select></label>
    </details>
    {inputError && <p role="alert">{inputError}</p>}
    {comparison && diameter !== undefined && <div className={"diameter-result" + (tight ? " tight" : "")} role={tight ? "alert" : "status"}>
      <strong>{tight && <CircleAlert size={14}/>} {gapLabel(comparison)}</strong>
      {tight && <small>{section === "shank_diameter" ? "Check the intended press fit against your measured donor." : comparison.clearance < 0 ? "The hole is too small for the refill." : "The diameters match with no room to slide."}</small>}
      <small>Entered hole Ø{format(diameter)} mm · {sections[section]?.toLowerCase()} Ø{format(refillDiameter)} mm</small>
    </div>}
  </>;
}

export default function RefillDiameterChecks({project, commit, installed, bodies, surfaces, matrices, values}: Props) {
  const [selected, setSelected] = useState("");
  const ids = bodies.map((b) => b.id);
  const checks = installed.flatMap((refill) =>
    surfaces && matrices ? refillBoreChecks(refill.bodyId, ids, surfaces, matrices).map((check) => ({...check, refill})) : []
  ).sort((a,b) => a.clearance - b.clearance);
  const tightest = checks[0];
  const which = installed.find((r) => r.bodyId === selected) ?? tightest?.refill ?? installed[0];
  function partName(id: string) { return bodies.find((b) => b.id === id)?.name ?? id; }
  function result(row: typeof tightest) {
    const tight = row.clearance <= 0;
    return <div className={"diameter-result" + (tight ? " tight" : "")} role={tight ? "alert" : "status"}>
      <strong>{tight && <CircleAlert size={14}/>} {gapLabel(row)}</strong>
      {tight && <small>{row.clearance < 0 ? "The bore is too small for this section of the refill." : "The diameters match with no room to slide."}</small>}
      <small>{partName(row.bodyId)} · Ø{format(row.boreDiameter)} mm bore</small>
      <small>{partName(row.refill.bodyId)} · Ø{format(row.refillDiameter)} mm at this bore</small>
    </div>;
  }
  return <section aria-label="Diameter clearance"><h3>Diameter clearance</h3>
    {tightest ? <>
      {result(tightest)}
      {checks.length > 1 && <details><summary>Other measured bores ({checks.length - 1})</summary>
        {checks.slice(1).map((row) => <div key={row.refill.bodyId + row.boreKey}>{result(row)}</div>)}
      </details>}
      <p>Checks cylindrical holes against straight and tapered refill sections in the saved pose.</p>
    </> : <p>{surfaces && matrices ? "No matching cylindrical bore at this pose. Compare a measured hole below." : "Model measurements unavailable until the assembly is ready."}</p>}
    {installed.length > 1 && <label>Refill<select aria-label="Refill to check" value={which.bodyId} onChange={(e) => setSelected(e.target.value)}>
      {installed.map((r) => <option key={r.bodyId} value={r.bodyId}>{partName(r.bodyId)} · {r.prefix}</option>)}
    </select></label>}
    <ManualDiameter key={project.id + which.bodyId} project={project} commit={commit} refill={which} values={values}/>
  </section>;
}
