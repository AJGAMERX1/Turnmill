import { useRef, useState, type RefObject } from "react";
import { Check, Ruler } from "lucide-react";
import { previewSlimPen } from "./slimPen";
import { prepareWritingFit, type WritingResult } from "./prepareWritingFit";
import SlimSizeInputs from "./SlimSizeInputs";
import { savedSlimSettings, type SlimSettings } from "./slimSizing";
import { lengthText, type WritingSetup } from "./writingConeSeat";
import type { WritingRequest } from "./writingFitJob";
import type { FinishBodySnapshot } from "./geometry";
import type { Project } from "./types";

type Props = { knownFit?: WritingResult; project: Project; setup: WritingSetup; ready: boolean; request: RefObject<WritingRequest | null>;
  commit: (p: Project, bodies?: FinishBodySnapshot[]) => Project };
type Preview = Awaited<ReturnType<typeof previewSlimPen>>;

export default function SlimPenPanel({ project, setup, ready, request, commit, knownFit }: Props) {
  const [edits, setEdits] = useState<Partial<SlimSettings>>({});
  const settings: SlimSettings = { ...savedSlimSettings(project.workspaces?.slimPens?.[setup.barrelId]), ...edits };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{source: Project; key: string; error?: string; result?: Preview; applied?: boolean}>();
  const key = JSON.stringify([setup, settings]);
  const base = useRef<{ setupKey: string; fit: WritingResult } | undefined>(undefined);
  const active = useRef({ project, key }); active.current = { project, key };
  const shown = message?.source === project && message.key === key ? message : undefined;
  const result = shown?.result;
  const edit = (value: Partial<SlimSettings>) => { setEdits({ ...edits, ...value }); setMessage(undefined); };
  async function preview() {
    if (!request.current || !ready || busy) return;
    setBusy(true); setMessage(undefined);
    try {
      const run = request.current, setupKey = JSON.stringify(setup);
      const result = await previewSlimPen(project, setup, settings, run, async () => {
        if (knownFit?.source === project) return knownFit;
        if (base.current?.fit.source === project && base.current.setupKey === setupKey) return base.current.fit;
        const fit = await prepareWritingFit(project, setup, run);
        base.current = { setupKey, fit };
        return fit;
      });
      if (active.current.project === project && active.current.key === key) setMessage({ source: project, key, result });
    } catch (cause) {
      if (active.current.project === project && active.current.key === key) setMessage({ source: project, key, error: (cause as Error).message });
    } finally { setBusy(false); }
  }
  return <section aria-label="Slim pen" className="writing-fit slim-pen"><h3>Slim pen</h3>
    <SlimSizeInputs settings={settings} disabled={busy} onChange={edit}/>
    <button className="bench-action" disabled={!ready || busy} onClick={() => void preview()}><Ruler size={15}/>{busy ? "Checking slimmer solids…" : "Preview slimming"}</button>
    {shown?.error && <p role="alert" className="fit-warning">{shown.error}</p>}
    {result && <div className="writing-results" role="status"><strong>{shown.applied ? "Slimmer pen applied" : "Verified size preview"}</strong>
      <dl>{[["Original outside diameter",result.previous],["Widest refill",result.widest],["Barrel bore",result.bore],
        ["Requested outside diameter",result.requested],["Achievable outside diameter",result.diameter]].map(([label,n]) =>
          <div key={label}><dt>{label}</dt><dd>Ø{lengthText(Number(n))}</dd></div>)}</dl>
      {result.diameter > result.requested + 0.001 && <p><b>Size limit</b> · {result.limitingReason}</p>}
      <p>Cone thread {result.coneThread}{result.capThreads.length > 0 && " · Cap thread " + result.capThreads.join(", ")}.</p>
      <p>Writing tip projects {lengthText(result.proof.fit.requestedExposure)}. Rear endplay is {lengthText(result.proof.fit.rearGap!)}.
        {result.proof.caps > 0 && " Cap clears at both ends."}</p>
      {result.addsWritingFit && !shown.applied && <p>Applying also sets up the writing seat and rear support.</p>}
      {!shown.applied && <button className="bench-action" disabled={!ready || busy} onClick={() => {
        const stored = commit(result.project, result.proof.checkedBodies);
        setMessage({source: stored, key,
          result: { ...result, project: stored }, applied: true});
      }}><Check size={15}/>Apply slimmer pen</button>}
    </div>}
  </section>;
}
