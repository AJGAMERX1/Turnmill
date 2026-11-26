import { useState, type ComponentProps } from "react";
import { Modal } from "./Dialogs";
import ThreadsDialog from "./ThreadsDialog";
import { evaluate, resolveParameters } from "./expressions";
import type { FitSurface } from "./fitSurfaces";
import { uid } from "./projects";
import { isSleeveDonor, refillComponents, refillDimensions, type RefillComponent } from "./refills";
import { isScaleFeature } from "./secondaryEngraving";
import { stockProfile } from "./SketchStock";
import { barrelAxis, barrelEnd } from "./threadedCone";
import type { Project } from "./types";

type Props = Pick<ComponentProps<typeof ThreadsDialog>, "project" | "measurementError" | "onClose" | "onParameters"> & {
  sourceId: string;
  solids: { id: string; name: string }[];
  surfaces?: FitSurface[][];
  onCreateBarrel: (project: Project, id: string) => void;
  onSave: (project: Project, newId: string, showAssembly: boolean, hostId: string, adjustments?: string[], restoredBarrelId?: string) => void;
  onSingle: (hostId: string) => void;
  onEdit: (featureId: string, finishId: string, hostId: string) => void;
};

function StarterBarrel({ project, refill, onCreateBarrel }: Pick<Props, "project" | "onCreateBarrel"> & { refill: RefillComponent }) {
  const dims = refillDimensions(project, refill.bodyId)!;
  const donor = isSleeveDonor(refill.kind);
  const exposure = donor ? dims.seat_distance : 2;
  const cartridgeOD = donor ? dims.shank_diameter : Math.max(dims.body_diameter, dims.tail_diameter || 0,
    dims.reservoir_front_diameter || 0, dims.neck_diameter || 0, dims.guide_diameter);
  const starterBore = donor ? cartridgeOD + Math.min(0.1, (dims.collar_diameter - cartridgeOD) / 2) : cartridgeOD + 0.3;
  const [length, setLength] = useState(Math.ceil(dims.length - exposure + 2) + " mm");
  const [outside, setOutside] = useState(Math.max(10, Math.ceil(starterBore + 4)) + " mm");
  const [bore, setBore] = useState(Number(starterBore.toFixed(5)) + " mm");
  const [error, setError] = useState("");
  return <form onSubmit={event => {
    event.preventDefault();
    try {
      const id = uid(), values = resolveParameters(project.parameters);
      const opening = evaluate(bore, values);
      const minimum = donor ? dims.body_diameter : cartridgeOD;
      if (opening < minimum - 1e-6)
        throw Error("The refill needs a bore of at least " + Number(minimum.toFixed(5)) + " mm. Increase the bore diameter.");
      if (donor && opening >= dims.collar_diameter - 1e-6)
        throw Error("Choose a bore smaller than the donor’s " + dims.collar_diameter + " mm stop collar so it seats against the barrel.");
      const left = refill.reversed ? dims.length - exposure + " mm - (" + length + ")" : exposure + " mm";
      const names = new Set([...project.features, ...(project.emptyParts ?? [])].map(f => f.name));
      let name = "Barrel";
      for (let n = 2; names.has(name); n++) name = "Barrel " + n;
      const profile = stockProfile({ id: uid(), partId: id, name: name + " profile", points: [], constraints: [] },
        { x: left, y: "0 mm" }, length, outside, bore, true, values);
      const next: Project = { ...project, sketches: [...project.sketches, profile], features: [...project.features,
        { id, name, kind: "revolve", operation: "new", sketchId: profile.id, amount: "360 deg", suppressed: false }] };
      onCreateBarrel(next, id);
    } catch (cause) { setError((cause as Error).message); }
  }}>
    <p className="helper">Create a separate barrel for the refill. These starting dimensions give the refill room inside the bore.</p>
    <label>Axial length<input required value={length} onChange={e => setLength(e.target.value)}/></label>
    <label>Outside diameter<input required value={outside} onChange={e => setOutside(e.target.value)}/></label>
    <label>Bore diameter<input required value={bore} onChange={e => setBore(e.target.value)}/></label>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="dialog-actions"><button className="primary" type="submit">Create barrel</button></div>
  </form>;
}

export default function BarrelThreads({ project, sourceId, solids, surfaces, measurementError, onCreateBarrel,
  onSave, onSingle, onEdit, onClose, onParameters }: Props) {
  const [chosen, setChosen] = useState("");
  const [part, setPart] = useState<"cone" | "cap">("cone");
  const refills = refillComponents(project);
  const refill = refills.find(r => r.bodyId === sourceId);
  const refillName = solids.find(f => f.id === sourceId)?.name;
  const parent = refill && project.workspaces?.joints?.[refill.bodyId]?.parent;
  const candidates = solids.filter(({ id }, i) => {
    // A direct selection also supports manual threads on a finished part.
    if (!refill && id === sourceId) return true;
    if (refills.some(r => r.bodyId === id) || project.workspaces?.hardwareComponents?.[id] ||
      (id !== parent && project.workspaces?.joints?.[id]?.threadMate) || project.workspaces?.capMounts?.[id] || isScaleFeature(project, id)) return false;
    const measured = surfaces?.[i];
    if (!measured) return false;
    const root = project.features.find(f => f.id === id);
    const axis = barrelAxis(root, measured);
    return !!(barrelEnd(measured, axis, "start") || barrelEnd(measured, axis, "end"));
  });
  const preferred = refill ? candidates.find(f => f.id === parent) ?? (candidates.length === 1 ? candidates[0] : undefined)
    : candidates.find(f => f.id === sourceId);
  const host = candidates.find(f => f.id === chosen) ?? preferred;
  const picker = <>{refill && <p className="helper">{refillName} is the refill. The matching threads go on the barrel.</p>}
    {(refill || candidates.length > 1) && candidates.length > 0 && <label>Barrel<select aria-label="Barrel" value={host?.id ?? ""}
      onChange={e => setChosen(e.target.value)}>
      {!host && <option value="">Choose a barrel</option>}
      {candidates.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}
    </select></label>}</>;
  if (!host) return <Modal title="Threads" onClose={onClose}>
    {picker}
    {measurementError ? <p role="alert" className="error-text">{measurementError}</p> : !surfaces ? <p role="status">Measuring barrel ends…</p>
      : refill && candidates.length === 0 ? <StarterBarrel project={project} refill={refill} onCreateBarrel={onCreateBarrel}/>
      : <p className="helper">Choose the barrel that will carry the threads.</p>}
  </Modal>;
  return <ThreadsDialog key={host.id} project={project} bodyId={host.id} targetPicker={picker}
    initialPart={part} onPartChange={setPart} surfaces={surfaces?.[solids.findIndex(f => f.id === host.id)]} measurementError={measurementError}
    onClose={onClose} onParameters={onParameters} onSingle={() => onSingle(host.id)}
    onEdit={(featureId, finishId) => onEdit(featureId, finishId, host.id)}
    onSave={(next, id, showAssembly, adjustments, restoredBarrelId) => onSave(next, id, showAssembly, host.id, adjustments, restoredBarrelId)}/>;
}
