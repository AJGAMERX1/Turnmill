import { useRef, useState, type RefObject } from "react";
import SlimPenPanel from "./SlimPenPanel";
import { Check, ScanLine } from "lucide-react";
import { prepareWritingFit, type WritingResult } from "./prepareWritingFit";
import type { FinishBodySnapshot } from "./geometry";
import { isSleeveDonor, refillCatalog, type RefillComponent } from "./refills";
import { setCapMount, type CapMount } from "./threadedCone";
import type { Project } from "./types";
import { lengthText, type WritingSetup } from "./writingConeSeat";
import { writingNoses, type WritingFit } from "./writingFit";
import type { WritingRequest } from "./writingFitJob";

type Props = {
  project: Project; refills: RefillComponent[]; ready: boolean;
  onRefill: () => void; onThreads: (bodyId: string) => void;
  request: RefObject<WritingRequest | null>; commit: (p: Project, bodies?: FinishBodySnapshot[]) => Project;
};


export default function WritingFitPanel({ project, refills, ready, request, commit, onRefill, onThreads }: Props) {
  const noses = writingNoses(project);
  const cartridges = refills.filter(r => !isSleeveDonor(r.kind));
  const [noseChoice, chooseNose] = useState(""), [refillChoice, chooseRefill] = useState("");
  const nose = noses.find(n => n.coneId === noseChoice) ?? noses[0];
  const saved: WritingSetup | undefined = project.workspaces?.writingSetups?.[nose?.coneId];
  const refill = cartridges.find(r => r.bodyId === refillChoice) ?? cartridges.find(r => r.bodyId === saved?.refillId) ?? cartridges[0];
  const [edits, setEdits] = useState<Partial<Pick<WritingSetup,"projection"|"clearance"|"endplay">>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<WritingResult>();
  const [observed, setObserved] = useState<{ source: Project; fit: WritingFit }>();
  const activeProject = useRef(project);
  activeProject.current = project;
  const shown = result?.source === project ? result : undefined;
  const projection = edits.projection ?? saved?.projection ?? "1.5 mm";
  const clearance = edits.clearance ?? saved?.clearance ?? "0.10 mm";
  const endplay = edits.endplay ?? saved?.endplay ?? "0 mm";
  const cap = Object.entries((project.workspaces?.capMounts ?? {}) as Record<string,CapMount>).find(([id,m]) =>
    m.barrelId === nose?.barrelId && project.features.some(f => f.id === id && !f.suppressed));
  function clear() { setError(""); setResult(undefined); setObserved(undefined); }
  async function check() {
    if (!nose || !refill || !request.current || !ready || busy) return;
    const run = request.current;
    const setup: WritingSetup = { coneId: nose.coneId, barrelId: nose.barrelId, refillId: refill.bodyId, projection, clearance, endplay };
    setBusy(true); clear();
    try {
      const next = await prepareWritingFit(project, setup, run, fit => {
        if (activeProject.current === project) setObserved({ source: project, fit });
      });
      if (activeProject.current === project) setResult(next);
    } catch (e) { if (activeProject.current === project) setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const edit = (key: keyof typeof edits, value: string) => { setEdits({ ...edits, [key]: value }); clear(); };
  if (!nose || !refill) {
    const imported = project.features.some(f => f.kind === "import" && !f.suppressed);
    return <section id="studio-slim" tabIndex={-1} aria-label="Slim pen" className="writing-fit slim-pen">
      <h3>Slim pen</h3>
      <p>{!refill
        ? refills.length ? "Slim supports Parker-style G2 and EnerGel cartridges. BIC front inserts use Snap to fit in Assembly."
          : "Choose a Parker-style G2 or EnerGel cartridge to size the barrel around your refill."
        : "Add a screw-on cone to the barrel to check the writing fit and preview a slimmer pen."}</p>
      {imported && <p>For a saved Turnmill pen, choose Open project in the import dialog to keep its editable barrel, cone and refill.</p>}
      {refill
        ? <button className="bench-action" onClick={() => onThreads(refill.bodyId)}>Set up screw-on cone</button>
        : <button className="bench-action" onClick={onRefill}>Choose cartridge</button>}
    </section>;
  }
  return <><section aria-label="Writing fit" className="writing-fit"><h3>Writing fit</h3>
    {noses.length > 1 && <label>Cone<select value={nose.coneId} disabled={busy} onChange={e => {chooseNose(e.target.value); setEdits({}); clear();}}>
      {noses.map(n => <option key={n.coneId} value={n.coneId}>{n.name}</option>)}</select></label>}
    {cartridges.length > 1 && <label>Cartridge<select value={refill.bodyId} disabled={busy} onChange={e => {chooseRefill(e.target.value); clear();}}>
      {cartridges.map(r => <option key={r.bodyId} value={r.bodyId}>{project.features.find(f => f.id === r.bodyId)?.name ?? refillCatalog[r.kind].name} · {r.prefix}</option>)}</select></label>}
    {saved?.needsRefit && <p>The cartridge changed. Check it against the existing cone and backing.</p>}
    <label>Tip projection<input disabled={busy} value={projection} onChange={e => edit("projection",e.target.value)}/></label>
    <details><summary>Fit allowances</summary>
      <label>Guide clearance<input disabled={busy} value={clearance} onChange={e => edit("clearance",e.target.value)}/></label>
      <label>Rear endplay<input disabled={busy} value={endplay} onChange={e => edit("endplay",e.target.value)}/></label>
      <p>Guide clearance is the difference in diameters. Endplay is how far the refill can move back under writing pressure.</p>
    </details>
    <button className="bench-action" disabled={busy || !ready} onClick={() => void check()}><ScanLine size={16}/>{busy ? "Checking solids…" : "Check writing fit"}</button>
    {error && <div role="alert"><p className="fit-warning">{error}</p>
      {observed?.source === project && observed.fit.coneClearance && <p>At the requested projection, the tightest measured cone bore has {lengthText(Math.abs(observed.fit.coneClearance.clearance))} {observed.fit.coneClearance.status}.</p>}
    </div>}
    {shown && <div className="writing-results" role="status"><strong>{shown.applied ? "Writing fit verified" : "Proposed writing fit"}</strong>
      {shown.before && !shown.applied && <p>{shown.before}</p>}<p>{shown.summary}</p><dl>
        <div><dt>Tip beyond cone</dt><dd>{lengthText(shown.proof.fit.requestedExposure)}</dd></div>
        <div><dt>Guide bore</dt><dd>Ø{lengthText(shown.proof.fit.openingDiameter)}</dd></div>
        <div><dt>Rear endplay</dt><dd>{lengthText(shown.proof.fit.rearGap!)}</dd></div>
        <div><dt>Cone lip clears paper above</dt><dd>{Math.ceil(Math.atan2(shown.proof.fit.rimDiameter / 2, shown.proof.fit.requestedExposure - shown.proof.fit.rearGap!) * 180 / Math.PI)}°</dd></div>
        <div><dt>Cap clearance</dt><dd>{shown.proof.caps ? "Front and posted" : "No paired cap"}</dd></div>
      </dl><p>Checked against the modeled cartridge. Measure your refill’s shoulder and tail before machining.</p>
      {!shown.applied && <button disabled={!ready} className="bench-action" onClick={() => {
        const stored = commit(shown.project,shown.proof.checkedBodies);
        setResult({ ...shown, source: stored, project: stored, applied: true, summary: "The cone seats the front shoulder and the barrel supports the tail." });
      }}><Check size={16}/>Apply writing fit</button>}
    </div>}
    {cap && <button className="bench-text" disabled={busy || !ready} onClick={() => {
      const [id,m] = cap;
      try { commit(setCapMount(project,id,m.active === "start" ? "end" : "start")); clear(); }
      catch (cause) { setError((cause as Error).message); }
    }}>{cap[1].active === cap[1].front ? "Post cap for writing" : "Cover writing tip"}</button>}
  </section>
  <SlimPenPanel knownFit={shown} key={nose.coneId + ":" + refill.bodyId} project={project} ready={ready} commit={commit} request={request}
    setup={{ coneId: nose.coneId, barrelId: nose.barrelId, refillId: refill.bodyId, projection, clearance, endplay }}/>
  </>;
}
