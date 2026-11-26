import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { Project } from "./types";
import SlimSizeInputs from "./SlimSizeInputs";
import { savedSlimSettings, type SlimSettings } from "./slimSizing";
import type { previewSlimBolt } from "./slimBoltPen";
import { lengthText as mm } from "./writingConeSeat";

type Result = Awaited<ReturnType<typeof previewSlimBolt>>;
type Snapshot = { source: Project; signature: string; result: Result; applied?: boolean };
export default function SlimBoltPanel({ project, commit }: { project: Project; commit: (p: Project) => Project }) {
  const [edits, setEdits] = useState<Partial<SlimSettings>>({});
  const [snapshot, setSnapshot] = useState<Snapshot>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const work = useRef<Worker | null>(null), current = useRef(project);
  current.current = project;
  useEffect(() => {
    setError(""); setBusy(false);
    return () => { work.current?.terminate(); work.current = null; };
  }, [project]);
  const settings = { ...savedSlimSettings(project.workspaces?.slimBolt), ...edits }, signature = JSON.stringify(settings);
  const shown = snapshot?.source === project && snapshot.signature === signature ? snapshot : undefined;
  function preview() {
    if (busy) return;
    setBusy(true); setError(""); setSnapshot(undefined);
    try {
      const worker = new Worker(new URL("./slimBoltWorker.ts", import.meta.url), { type: "module" });
      work.current = worker;
      const finish = () => { worker.terminate(); if (work.current === worker) work.current = null; };
      worker.onmessage = ({ data }) => {
        finish();
        if (current.current !== project) return;
        setBusy(false);
        if (data.error) setError(data.error); else setSnapshot({ source: project, signature, result: data.result });
      };
      worker.onerror = () => { finish(); if (current.current === project) { setBusy(false); setError("The bolt check could not finish. Reopen the preview and try again."); } };
      worker.postMessage({ project, settings });
    } catch (e) { setBusy(false); setError((e as Error).message); }
  }
  const result = shown?.result;
  return <section id="studio-slim" tabIndex={-1} aria-label="Slim pen" className="writing-fit slim-pen"><h3>Slim pen</h3>
    <SlimSizeInputs settings={settings} disabled={busy} onChange={change => { setEdits({ ...edits, ...change }); setError(""); }} />
    <button className="bench-action" disabled={busy} onClick={preview}>{busy ? "Checking bolt travel…" : "Preview slimming"}</button>
    {error && <p role="alert" className="fit-warning">{error}</p>}
    {result && <div className="writing-results" role="status"><strong>{shown.applied ? "Slimmer pen applied" : "Verified size preview"}</strong><dl>
      <div><dt>Widest refill</dt><dd>Ø{mm(result.widest)}</dd></div>
      <div><dt>Requested body OD</dt><dd>{mm(result.requested)}</dd></div>
      <div><dt>Current body OD</dt><dd>{mm(result.previous)}</dd></div>
      <div><dt>Achievable body OD</dt><dd>{mm(result.diameter)}</dd></div>
      <div><dt>Refill bore</dt><dd>{mm(result.bore)}</dd></div>
      <div><dt>Clip and stud envelope Ø</dt><dd>{mm(result.envelope)}</dd></div>
    </dl>
      {result.diameter > result.requested + .00001 && <p>The nose O-ring seat, carrier and spring chamber set the minimum body diameter.</p>}
      <p>Writing projection {mm(result.exposure)}. Pocket recess {mm(result.recess)}. The stud clears the full J-slot by at least {mm(Math.floor(result.slotGap * 1000) / 1000)}.</p>
      <p>The return spring has {mm(result.springOpen)} of seat spacing in pocket position and {mm(result.springPressed)} at full press. The spring chamber retains its {mm(result.carrierBore)} bore.</p>
      {!shown.applied && <button className="bench-action" onClick={() => { const stored = commit(result.project); setSnapshot({ source: stored, signature, result, applied: true }); }}><Check size={15} />Apply slimmer pen</button>}
    </div>}
  </section>;
}
