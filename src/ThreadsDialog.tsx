import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Vector3 } from "three";
import { Modal } from "./Dialogs";
import { evaluateModel } from "./buildModel";
import { fitCapEnvelope } from "./capSizing";
import { validateCapProfile } from "./capProfile";
import { evaluate, resolveParameters } from "./expressions";
import { threadMinorDiameter, threadPresets } from "./finishingTypes";
import type { FitSurface } from "./fitSurfaces";
import { jointMount, type JointConfig } from "./kinematics";
import { refillComponents } from "./refills";
import { partFeatures } from "./partTabs";
import { resolveThreadMates } from "./threadMates";
import { barrelAxis, barrelEnd, capAttachmentIssue, hasCapAttachments, legacyCapBarrelStock, legacyCapForBarrel, repairCapDiameter, shoulderOutside, compatiblePairSizes, createThreadedCap, createThreadedCone, type BarrelEnd, type CapSettings, type PairSettings } from "./threadedCone";
import type { Project } from "./types";
import type { KernelReply } from "./Viewport";
import "./threadsDialog.css";

type Attachment = "cone" | "cap";
const mmField = (value: number) => Number(value.toFixed(6)) + " mm";

type Props = {
  project: Project; bodyId: string; surfaces?: FitSurface[]; measurementError?: string; targetPicker?: ReactNode;
  initialPart?: Attachment; onPartChange?: (kind: Attachment) => void;
  onSingle: () => void; onParameters: () => void; onEdit: (featureId: string, finishId: string) => void;
  onSave: (next: Project, id: string, showAssembly: boolean, adjustments?: string[], restoredBarrelId?: string) => void; onClose: () => void;
};

function seatedRefillFront(project: Project, bodyId: string, axis: BarrelEnd["axis"]): PairSettings["end"] | undefined {
  const joints: JointConfig = project.workspaces?.joints ?? {};
  const ends = new Set<PairSettings["end"]>();
  const values = resolveParameters(project.parameters);
  for (const refill of refillComponents(project)) {
    const joint = joints[refill.bodyId];
    if (!joint?.refillSnap || joint.parent !== bodyId) continue;
    const direction = new Vector3(refill.reversed ? -1 : 1, 0, 0).transformDirection(jointMount(joint, values));
    const along = axis === "X" ? direction.x : direction.z;
    if (Math.abs(along) > 1 - 1e-6) ends.add(along > 0 ? "start" : "end");
  }
  return ends.size === 1 ? [...ends][0] : undefined;
}

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

function CapSection({ project, stock, rear, settings }: { project: Project; stock?: BarrelEnd; rear?: BarrelEnd; settings: CapSettings }) {
  if (!stock || !rear) return null;
  try {
    const values = resolveParameters(project.parameters);
    const mm = (expression: string) => evaluate(expression, values);
    const preset = threadPresets.find(item => item.label === settings.size);
    if (!preset) return null;
    const length = mm(settings.capLength), diameter = mm(settings.capDiameter), major = mm(preset.diameter);
    const thread = mm(settings.length), wall = mm(settings.wall);
    const crown = settings.crown === "flat" ? 0 : mm(settings.crownLength);
    validateCapProfile({ prefix: "cap", crown: settings.crown }, {
      cap_diameter: diameter, cap_major: major, cap_crown: crown, cap_wall: wall,
      cap_thread_length: thread, cap_length: length,
    });
    const scale = Math.min(190 / length, 56 / Math.max(diameter, stock.outside, rear.outside));
    const shoulder = 96, end = shoulder + length * scale, turn = end - crown * scale;
    const cavity = turn - wall * scale, r = diameter * scale / 2, bore = major * scale / 2;
    const shaft = shoulderOutside(stock, thread) * scale / 2, passage = stock.bore * scale / 2;
    const rearRadius = shoulderOutside(rear, thread) * scale / 2, rearBore = rear.bore * scale / 2;
    const rearEnd = Math.max(6, 44 - thread * scale);
    const runout = shoulder + thread * scale;
    const blend = crown * scale;
    const arc = blend ? (r * r + blend * blend) / (2 * blend) : 0;
    const top = settings.crown === "domed" ? `A${arc} ${arc} 0 0 1 ${end} 0`
      : settings.crown === "tapered" ? `L${end} ${-r / 2}V0` : `H${end}V0`;
    const lower = settings.crown === "domed" ? `A${arc} ${arc} 0 0 1 ${turn} ${r}`
      : settings.crown === "tapered" ? `V${r / 2}L${turn} ${r}` : `V${r}`;
    const pocket = threadMinorDiameter(major, mm(preset.pitch));
    return <><svg className="thread-pair-section cap-section" role="img" aria-label={`Section of ${settings.crown} screw-on cap`}
      viewBox="0 0 320 76">
      <g transform={settings.end === "start" ? "translate(320 38) scale(-1 1)" : "translate(0 38)"}>
        <path fill="#526c6f" stroke="#9eb8bb" d={`M${rearEnd} ${-bore}H44V${-rearRadius}L${shoulder} ${-shaft}V${-bore}H${runout}V${-passage}L${rearEnd} ${-rearBore}Z M${rearEnd} ${bore}H44V${rearRadius}L${shoulder} ${shaft}V${bore}H${runout}V${passage}L${rearEnd} ${rearBore}Z`}/>
        <path fill="#987241" stroke="#edbc73" d={`M${shoulder} ${-r}H${turn}${top}${lower}H${shoulder}V${bore}H${cavity}V${-bore}H${shoulder}Z`}/>
        <path d={`M${shoulder} ${-bore}H${runout} M${shoulder} ${bore}H${runout} M${rearEnd} ${-bore}H44 M${rearEnd} ${bore}H44`} stroke="#f7d7a7" strokeDasharray="2 2" strokeWidth="2"/>
      </g>
      <path d="M4 38H316" stroke="#81908d" strokeDasharray="6 4"/>
    </svg><p className="helper">Room beyond threads · {Number((length - wall - crown - thread).toFixed(3))} mm deep × Ø{Number(pocket.toFixed(3))} mm</p></>;
  } catch (cause) {
    return <p className="helper">{(cause as Error).message}</p>;
  }
}

export default function ThreadsDialog({ project, bodyId, surfaces, measurementError, targetPicker, initialPart = "cone", onPartChange, onSingle, onParameters, onEdit, onSave, onClose }: Props) {
  const features = partFeatures(project, bodyId).filter(f => !f.suppressed);
  const root = features[0];
  const axis = barrelAxis(root, surfaces);
  const existing = features.flatMap(feature => feature.finishes?.filter(f => f.kind === "thread")
    .map(f => ({ feature, finish: f })) ?? []);
  function capFront() {
    const socket = existing.find(({finish}) => finish.kind === "thread" && !finish.suppressed && finish.side === "internal")?.finish;
    if (socket?.kind === "thread") return socket.end;
    try { return seatedRefillFront(project, bodyId, axis); }
    catch { return undefined; }
  }
  const [part, setPart] = useState<Attachment>(initialPart);
  const [end, setEnd] = useState<PairSettings["end"]>(() => (initialPart === "cap" && capFront()) || "end");
  const stock = surfaces && barrelEnd(surfaces, axis, end);
  const cap = part === "cap";
  const hasAttachments = cap && hasCapAttachments(project, bodyId);
  const rear = cap && surfaces ? barrelEnd(surfaces, axis, end === "end" ? "start" : "end") : undefined;
  const [requestedSize, setSize] = useState("");
  const [allowance, setAllowance] = useState("0.10 mm");
  const [length, setLength] = useState("4.5 mm"), [coneLength, setConeLength] = useState("15 mm");
  const [tipInput, setTip] = useState<string>(), [openingInput, setOpening] = useState<string>();
  const [closeBack, setCloseBack] = useState(false), [thickness, setThickness] = useState("2 mm");
  const [mode, setMode] = useState<PairSettings["mode"]>("modeled");
  const [capLengthInput, setCapLength] = useState<string>(), [outside, setOutside] = useState<string>();
  const [crown, setCrown] = useState<CapSettings["crown"]>("domed");
  const [crownInput, setCrownLength] = useState<string>(), [wall, setWall] = useState("1.5 mm");
  function read(expression: string) {
    try { return evaluate(expression, resolveParameters(project.parameters)); }
    catch { return undefined; }
  }
  const allowanceMm = read(allowance), threadLengthMm = read(length);
  const shoulder = stock && threadLengthMm && threadLengthMm > 0 ? shoulderOutside(stock, threadLengthMm) : undefined;
  const backShoulder = rear && threadLengthMm && threadLengthMm > 0 ? shoulderOutside(rear, threadLengthMm) : undefined;
  const capDiameter = outside ?? (shoulder ? mmField(shoulder) : "");
  const capOD = read(capDiameter);
  const candidates = stock && allowanceMm !== undefined && allowanceMm >= 0 && threadLengthMm !== undefined
    ? compatiblePairSizes(project, bodyId, stock, part, rear, allowanceMm, threadLengthMm) : [];
  const compatibleSizes = cap ? candidates.filter(label => {
    const preset = threadPresets.find(p => p.label === label);
    return preset && capOD !== undefined && capOD > evaluate(preset.diameter, {}) + 1e-5;
  }) : candidates;
  const size = compatibleSizes.includes(requestedSize) ? requestedSize : compatibleSizes[0] ?? "";
  const preset = threadPresets.find(p => p.label === size);
  const capLength = capLengthInput ?? (hasAttachments ? "28 mm" : "18 mm");
  const major = preset && evaluate(preset.diameter, {});
  const crownLength = crownInput ?? mmField(Math.min(2, (capOD ?? 4) / 2));
  const defaultTip = stock && Math.min(4, stock.outside * 0.75);
  const tipDiameter = tipInput ?? (defaultTip ? mmField(defaultTip) : "");
  const rootDiameter = major && preset && threadMinorDiameter(major - (allowanceMm ?? 0), evaluate(preset.pitch, {}));
  const opening = openingInput ?? (defaultTip && rootDiameter ? mmField(Math.min(2.5, defaultTip * 0.7, rootDiameter * 0.7)) : "");
  let stockIssue = "";
  if (surfaces) {
    if (!stock || (cap && !rear)) {
      stockIssue = cap
        ? "A cap needs a flat, round mounting face at both barrel ends. Choose another barrel or add a flat land at the pointed or missing end."
        : "This end has no flat, round mounting face. Choose the other barrel end, or add a flat land for the socket.";
    } else if (allowanceMm === undefined || allowanceMm < 0) {
      stockIssue = "Enter a nonnegative length under Fit allowance.";
    } else if (threadLengthMm === undefined || threadLengthMm <= 0) {
      stockIssue = "Enter a positive thread length.";
    } else if (cap && (!Number.isFinite(shoulder) || !Number.isFinite(backShoulder))) {
      stockIssue = "Choose a thread length that ends on a round shoulder at both ends of the barrel.";
    } else if (cap && candidates.length && !size) {
      stockIssue = "Increase the cap outside diameter to leave a wall around its threaded opening.";
    } else if (!size) {
      stockIssue = (cap && capAttachmentIssue(project, bodyId)) ||
        "No standard thread fits between the bore and the barrel surface. Try a shorter thread or a thicker barrel wall.";
    }
  }
  const capSettings = { end, size, length, mode, allowance, capLength, capDiameter, crown, crownLength, wall, matchBarrel: outside === undefined };
  let previewFit: ReturnType<typeof fitCapEnvelope> | undefined;
  if (cap && major) {
    try { previewFit = fitCapEnvelope(capSettings, resolveParameters(project.parameters), major); }
    catch { /* Incomplete inputs stay editable. */ }
  }
  const [busy, setBusy] = useState<"create" | "restore" | null>(null), [error, setError] = useState("");
  const repairHost = project.workspaces?.capMounts?.[bodyId]?.barrelId ?? bodyId;
  const repairId = legacyCapForBarrel(project, repairHost);
  const [otherTools, setOtherTools] = useState(false);
  const restoreView = !!repairId && !otherTools;
  const token = useRef(0), worker = useRef<Worker | null>(null);
  useLayoutEffect(() => () => { token.current++; worker.current?.terminate(); }, []);
  const connected = Object.entries((project.workspaces?.joints ?? {}) as JointConfig)
    .some(([id, joint]) => joint.threadMate && (id === bodyId || joint.parent === bodyId));
  async function create(restore = false) {
    if (busy || (restore ? !repairId : !stock || (cap && !rear) || !size || measurementError)) return;
    setBusy(restore ? "restore" : "create"); setError("");
    const request = ++token.current;
    try {
      const engine = new Worker(new URL("./kernel.ts", import.meta.url), { type: "module", name: "turnmill-thread-pair" });
      worker.current = engine;
      const host = restore ? repairHost : bodyId;
      const checkingCap = restore || cap;
      let revision = 0;
      async function build(next: Project, options: { measureRefillFit?: boolean; capPostingCheck?: { project: Project; capId: string; fitCavityDepth?: number } } = {}) {
        const model = await evaluateModel(next);
        if (token.current !== request) throw Error("Thread operation closed.");
        const rev = ++revision;
        type Reply = Extract<KernelReply, { type: "built" | "error" }>;
        const reply = await new Promise<Reply>((resolve, reject) => {
          engine.onerror = () => reject(Error("The geometry engine stopped while checking the threads."));
          engine.onmessage = ({ data }: MessageEvent<KernelReply>) => {
            if (data.revision === rev && (data.type === "built" || data.type === "error")) resolve(data);
          };
          engine.postMessage({ type: "build", revision: rev, features: model.features, ...options });
        });
        return { reply, model };
      }
      let next: Project, partId: string, changes: string[] = [];
      let fitting: ReturnType<typeof fitCapEnvelope> | undefined;
      if (restore && repairId) {
        const original = legacyCapBarrelStock(project, repairId);
        const { reply } = await build(original, { measureRefillFit: true });
        if (reply.type === "error") throw Error(reply.message);
        const measured = reply.fitSurfaces?.[0];
        if (!measured?.length) throw Error("Could not measure the original barrel at its cap seats.");
        const restored = repairCapDiameter(project, repairId, measured, undefined, true);
        next = restored.project; partId = repairId;
        changes = ["Changed " + restored.oldSize + " to " + restored.size + ". Cap and front shoulder now meet at Ø" + mmField(restored.outside) + "."];
      } else if (cap) {
        fitting = fitCapEnvelope(capSettings, resolveParameters(project.parameters), major!);
        const created = createThreadedCap(project, bodyId, stock!, fitting.settings, rear!);
        next = created.project; partId = created.capId; changes = fitting.changes;
      } else {
        const created = createThreadedCone(project, bodyId, stock!, { end, size, length, coneLength, tipDiameter,
          opening, allowance, mode, ...(closeBack ? { backWall: thickness } : {}) });
        next = created.project; partId = created.coneId;
      }
      async function check(fitCavityDepth?: number) {
        const history = checkingCap ? next.features : next.features.filter(f => f.id === partId || features.some(s => f.id === s.id));
        const { reply, model } = await build({ ...next, features: history }, checkingCap
          ? { capPostingCheck: { project: next, capId: partId, fitCavityDepth } } : {});
        if (reply.type === "built") resolveThreadMates({ [partId]: next.workspaces!.joints[partId] },
          reply.threadFrames ?? [], model.values, [host, partId]);
        return reply;
      }
      let verified = await check(fitting?.cavityDepth);
      if (token.current !== request) return;
      if (fitting && verified.type === "error" && verified.capFit) {
        const corrected = fitCapEnvelope(capSettings, resolveParameters(project.parameters), major!, verified.capFit);
        const profile = next.sketches.find(s => s.partId === partId)?.capProfile;
        if (!profile || corrected.cavityDepth <= fitting.cavityDepth) throw Error(verified.message);
        const lengthName = profile.prefix + "_length";
        next = { ...next, parameters: next.parameters.map(p =>
          p.name === lengthName ? { ...p, expression: corrected.settings.capLength } : p) };
        changes = corrected.changes;
        verified = await check();
      }
      if (token.current !== request) return;
      if (verified.type === "error") throw Error(verified.message);
      onSave(next, partId, !restore && (stock!.axis !== "X" || stock!.centerline.some(n => Math.abs(n) > 1e-6)), changes,
        restore ? host : undefined);
    } catch (cause) {
      if (token.current === request) setError((cause as Error).message);
    } finally {
      if (token.current === request) {
        worker.current?.terminate(); worker.current = null; setBusy(null);
      }
    }
  }
  function input(label: string, v: string, edit: (s: string) => void) {
    return <label>{label}<input aria-label={label} value={v} onChange={e => edit(e.target.value)}/></label>;
  }
  function choosePart(kind: "cone" | "cap") {
    if (kind === part) return;
    const front = kind === "cap" && capFront();
    if (front) setEnd(front);
    onPartChange?.(kind);
    setPart(kind); setSize(""); setError("");
  }
  if (restoreView) return <Modal title="Threads" onClose={onClose} className="thread-pair-dialog">
    <div className="thread-pair-scroll">
      <h3>Fit the cap flush to the barrel</h3>
      <p>Turn both raised mounts down inside the barrel’s original diameter. The cap rim will meet the front shoulder, and the same cap will still screw onto the back.</p>
      <button type="button" className="thread-shared" disabled={!!busy} onClick={() => { setOtherTools(true); setError(""); }}>Other thread tools</button>
    </div>
    <div className="thread-pair-footer">
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={!!busy} onClick={() => void create(true)}>
          {busy && <LoaderCircle size={14} className="spin"/>}{busy ? "Checking both cap positions…" : "Fit flush to barrel"}</button></div>
    </div>
  </Modal>;
  return <Modal title="Threads" onClose={onClose} className="thread-pair-dialog">
    <form className="thread-pair-form" onSubmit={e => { e.preventDefault(); void create(); }} onChange={() => setError("")}>
      <div className="thread-pair-scroll">
        <div className="thread-task"><div className="thread-part-choice" role="group" aria-label="Screw-on part">
          {(["cone", "cap"] as const).map(kind => <button key={kind} type="button" aria-pressed={part === kind} disabled={!!busy}
            onClick={() => choosePart(kind)}>Screw-on {kind}</button>)}</div>
          <button type="button" onClick={onSingle} disabled={!!busy}>Thread one part</button></div>
        {targetPicker && <fieldset disabled={!!busy}>{targetPicker}</fieldset>}
        {repairId && <button className="thread-shared" type="button" disabled={!!busy}
          onClick={() => { setOtherTools(false); setError(""); }}>Restore flush cap fit…</button>}
        <p className="helper">{cap ? `Cut matching threads on both ends of ${root?.name ?? "the barrel"}. The same cap covers the tip or screws onto the back while you write.`
          : `Add a removable cone to ${root?.name ?? "the barrel"}. Its threaded stem screws into a matching socket.`}</p>
        {cap && <p className="helper">The threads step inward at each end. The cap meets the front shoulder flush by default.</p>}
        {connected && <button className="thread-shared" type="button" disabled={!!busy} onClick={onParameters}>Edit shared thread parameters</button>}
        {existing.length > 0 && <details><summary>Edit existing threads ({existing.length})</summary>
          {existing.map(({ feature, finish }) => <button key={finish.id} disabled={!!busy} type="button"
            onClick={() => onEdit(feature.id, finish.id)}>{finish.name} · {feature.name}</button>)}</details>}
        {size && (cap ? <CapSection project={project} stock={stock} rear={rear} settings={previewFit?.settings ?? capSettings}/>
          : <JointSection start={end === "start"} closed={closeBack}/>)}
        {previewFit && previewFit.changes.length > 0 && <p className="helper" role="status">Automatic fit · {previewFit.changes.join(" ")}</p>}
        <fieldset disabled={!!busy}>
          <div className="thread-pair-grid">
            <label>{cap ? "Front end" : "Barrel end"}<select aria-label={cap ? "Front end" : "Barrel end"} value={end} onChange={e => { setEnd(e.target.value as PairSettings["end"]); setSize(""); }}>
              <option value="start">Start · min {axis}</option><option value="end">End · max {axis}</option>
            </select></label>
            <label>Thread size<select aria-label="Thread size" disabled={!compatibleSizes.length} value={size} onChange={e => setSize(e.target.value)}>
              {!size && <option value="">{surfaces ? "No compatible size" : "Measuring…"}</option>}
              {compatibleSizes.map(label => <option key={label}>{label}</option>)}
            </select></label>
            {input("Thread length", length, setLength)}
            {cap ? <>
              {input("Cap length", capLength, setCapLength)}
              <div>{input("Cap outside diameter", capDiameter, setOutside)}
                {outside !== undefined && <button className="thread-shared" type="button" onClick={() => setOutside(undefined)}>Match barrel</button>}</div>
              <label>Cap profile<select aria-label="Cap profile" value={crown} onChange={e => setCrown(e.target.value as CapSettings["crown"])}>
                <option value="flat">Flat</option><option value="domed">Domed</option><option value="tapered">Tapered</option>
              </select></label>
              {crown !== "flat" && input("Crown length", crownLength, setCrownLength)}
              {input("End wall thickness", wall, setWall)}
            </> : <>
              {input("Cone length", coneLength, setConeLength)}
              {input("Tip outside diameter", tipDiameter, setTip)}
              {input("Tip opening diameter", opening, setOpening)}
            </>}
          </div>
          {cap && Number.isFinite(shoulder) && Number.isFinite(backShoulder) && <p className="helper">
            Front Ø{Number(shoulder!.toFixed(3))} mm · Back Ø{Number(backShoulder!.toFixed(3))} mm at the shoulders</p>}
          {!cap && stock && <p className="helper">Barrel Ø{Number(stock.outside.toFixed(3))} mm · {stock.bore > 0
            ? "Bore Ø" + Number(stock.bore.toFixed(3)) + " mm" : "Solid end"}</p>}
          {cap && shoulder && backShoulder && Math.abs(shoulder - backShoulder) > 0.001
            ? <p className="helper">The shoulders have different diameters. Match barrel uses the front shoulder.</p> : null}
          {!cap && <label className="thread-close-back"><input type="checkbox" checked={closeBack}
            onChange={e => setCloseBack(e.target.checked)}/> Close back of barrel</label>}
          {!cap && closeBack && input("Back wall thickness", thickness, setThickness)}
          <label>Thread geometry<select aria-label="Thread geometry" value={mode} onChange={e => setMode(e.target.value as PairSettings["mode"])}>
            <option value="modeled">Modeled · cut helical grooves</option><option value="cosmetic">Cosmetic · show thread guides</option>
          </select></label>
          <details><summary>Fit allowance</summary>
            {input("Diametral allowance", allowance, setAllowance)}
            <p className="helper">This reduces the {cap ? "barrel" : "cone"}’s thread diameter relative to the socket. Verify the fit for your material and process.</p>
          </details>
        </fieldset>
      </div>
      <div className="thread-pair-footer">
        {(error || measurementError || stockIssue) && <p role="alert" className="error-text">{error || measurementError || stockIssue}</p>}
        {!surfaces && !error && !measurementError && <p className="helper">Measuring the barrel ends…</p>}
        <div className="dialog-actions"><button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={!!busy || !stock || (cap && !rear) || !size || !!measurementError}>
            {busy && <LoaderCircle size={14} className="spin"/>}{busy ? (cap || busy === "restore" ? "Checking both cap positions…" : "Checking both parts…") : `Create threaded ${part}`}
          </button></div>
      </div>
    </form>
  </Modal>;
}
