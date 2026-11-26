import { useState } from "react";
import { ArrowUpRight, Component, PenTool, SlidersHorizontal, Eye } from "lucide-react";
import { evaluate, resolveParameters } from "./expressions";
import { validateProjectScrewCones } from "./screwConeProfile";
import { massProperties, positionedProperties, type BodyProps } from "./materials";
import type { EvaluatedFeature, Project } from "./types";
import { refillCatalog, refillComponents, refillDimensions, reverseRefill } from "./refills";
import PenAppearancePanel from "./PenAppearancePanel";
import SlimBoltPanel from "./SlimBoltPanel";
import WritingFitPanel from "./WritingFitPanel";
import InputValue from "./InputValue";
import RefillDiameterChecks from "./RefillDiameterChecks";
import ReverseRefillButton from "./ReverseRefillButton";
import type { FitSurface } from "./fitSurfaces";

type Props = {
  project: Project;
  commit: (p: Project, bodies?: import("./geometry").FinishBodySnapshot[]) => Project;
  writingCheck: React.RefObject<import("./writingFitJob").WritingRequest | null>;
  solidFeatures: EvaluatedFeature[];
  selectedBodyId?: string;
  properties?: BodyProps[];
  matrices?: number[][];
  surfaces?: FitSurface[][];
  values: Record<string, number>;
  densities: number[];
  onRefill: () => void;
  onThreads: (bodyId: string) => void;
  onProject: () => void;
  onAssembly: () => void;
  onParameters: () => void;
  showInternals: boolean;
  setShowInternals: (enabled: boolean) => void;
};
const mm = (v: number) => Number(v.toFixed(2)) + " mm";

export default function PenBench({ project, commit, writingCheck, solidFeatures, selectedBodyId, properties, matrices, surfaces, values, densities,
  onRefill, onThreads, onProject, onAssembly, onParameters, showInternals, setShowInternals }: Props) {
  const [warning, setWarning] = useState("");
  const mounted = properties && matrices ? positionedProperties(properties, matrices) : [];
  const { mass, weightNewtons, center } = massProperties(mounted, densities);
  const grip = String(project.workspaces?.gripStation ?? "30 mm");
  const bolt = project.workspaces?.boltPen;
  const preset = bolt ? ["grip_diameter", "pocket_recess", "tip_projection", "guide_clearance"]
    : ["barrel_length", "outer_diameter", "bore_diameter"];
  const dimensions = preset.flatMap((key) => project.parameters.filter((p) => p.name === key));
  const installed = refillComponents(project).filter((r) => solidFeatures.some((f) => f.id === r.bodyId));
  const unknownMass = installed.filter((r) => !densities[solidFeatures.findIndex((f) => f.id === r.bodyId)]);
  let gripStation: number | undefined, fit: number | undefined;
  try {
    const values = resolveParameters(project.parameters);
    gripStation = evaluate(grip, values);
    const donor = bolt && refillDimensions(project, bolt.refillId);
    if (donor && !project.workspaces?.refills?.[bolt.refillId]?.reversed && Number.isFinite(values.tip_bore)) fit = values.tip_bore - donor.guide_diameter;
  } catch { /* Show editable inputs while a parameter or a joint is being repaired. */ }
  const offset = center && gripStation !== undefined ? center[0] - gripStation : undefined;
  function dimension(key: string, expression: string) {
    try {
      const parameters = project.parameters.map((p) => p.name === key ? { ...p, expression } : p);
      const next = { ...project, parameters };
      validateProjectScrewCones(next, resolveParameters(parameters), project);
      commit(next); setWarning("");
    } catch (e) { setWarning((e as Error).message); }
  }
  return <aside className="pen-bench tm-workspace" aria-label="Pen design bench">
    <div className="bench-heading"><h2>Design bench</h2><button onClick={onProject}>New pen <ArrowUpRight size={14}/></button></div>
    <section><h3>Refill</h3>
      {installed.length ? <ul>{installed.map((r) => {
        const name = solidFeatures.find((f) => f.id === r.bodyId)?.name || refillCatalog[r.kind].name;
        const duplicate = solidFeatures.filter((f) => f.name === name).length > 1;
        const label = duplicate ? name + " · " + r.prefix : name;
        return <li className="installed-refill" key={r.bodyId}><PenTool size={15}/><span>{label}</span>
          <ReverseRefillButton name={label} reversed={!!r.reversed} onReverse={() => commit(reverseRefill(project, r.bodyId))}/>
        </li>;
      })}</ul>
        : <p>Choose the cartridge your pen will write with.</p>}
      <button className="bench-action" onClick={onRefill}><PenTool size={16}/> Refill library</button>
      {fit !== undefined && <dl><div><dt>Design tip clearance</dt><dd>{mm(fit)}</dd></div></dl>}
      {fit !== undefined && <p>{fit < 0 ? "The guide is smaller than the refill tip." : "Calculated from the tip guide and bore dimensions."}</p>}
    </section>
    {bolt && <SlimBoltPanel project={project} commit={commit}/>}
    {!bolt && <WritingFitPanel project={project} onRefill={onRefill} onThreads={onThreads} refills={refillComponents(project).filter(r => project.features.some(f => f.id === r.bodyId && !f.suppressed))} commit={commit} request={writingCheck} ready={!!surfaces && !!matrices}/>}
    {installed.length > 0 && <RefillDiameterChecks project={project} commit={commit} installed={installed}
      bodies={solidFeatures} surfaces={surfaces} matrices={matrices} values={values}/>}
    <PenAppearancePanel key={project.id} project={project} preferredId={selectedBodyId} commit={commit}
      bodies={solidFeatures.filter(body => !installed.some(refill => refill.bodyId === body.id))}/>
    <section><h3>Body dimensions</h3>
      {dimensions.map((d) => <label key={d.name}>{d.label ?? d.name.replaceAll("_"," ")}
      <InputValue label={d.label ?? d.name} value={d.expression} onCommit={(value) => dimension(d.name, value)}/></label>)}
      <button className="bench-text" onClick={onParameters}><SlidersHorizontal size={14}/> All parameters</button>
    </section>
    <section><h3>Balance</h3><dl><div><dt>Modeled mass</dt><dd>{center ? Number(mass.toFixed(2)) + " g" : "—"}</dd></div>
      <div><dt title="At standard gravity (9.80665 m/s²)">Weight on Earth</dt><dd>{center ? Number(weightNewtons.toFixed(3)) + " N" : "—"}</dd></div>
      <div><dt>Balance along X</dt><dd>{center ? mm(center[0]) : "—"}</dd></div></dl>
      <label>Grip station<InputValue label="Grip station" value={grip} onCommit={(value) => {
        try { evaluate(value, resolveParameters(project.parameters)); commit({ ...project, workspaces: { ...project.workspaces, gripStation: value } }); setWarning(""); }
        catch (e) { setWarning((e as Error).message); }
      }}/></label>
      <p>{offset === undefined ? "Measure your grip along the model’s X axis." :
        Math.abs(offset) < 0.005 ? "The modeled balance point is at your grip." :
        "Balance sits " + mm(Math.abs(offset)) + " " + (bolt ? offset > 0 ? "toward the tail" : "toward the tip" : offset > 0 ? "along +X" : "along −X") + " from your grip."}</p>
      {unknownMass.length > 0 ? <p>Excludes the unweighed {unknownMass.map((r) => refillCatalog[r.kind].name).join(", ")}. Enter its filled mass in the refill library.</p>
        : installed.length > 0 && <p>Refill balance uses its filled mass at the envelope centroid.</p>}
    </section>
    <section><h3>Mechanism</h3>
      {(bolt || installed.length > 0) && <label className="bench-check"><Eye size={15}/> Reveal internals<input type="checkbox" checked={showInternals} onChange={(e) => setShowInternals(e.target.checked)}/></label>}
      <button className="bench-action" onClick={onAssembly}><Component size={16}/> Open assembly</button>
      {solidFeatures.length < 2 && <p>Add a refill or start a bolt-action pen to try a moving assembly.</p>}
    </section>
    {warning && <p role="alert">{warning}</p>}
  </aside>;
}
