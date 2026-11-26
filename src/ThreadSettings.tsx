import { useMemo, useState, type ReactNode } from "react";
import { evaluate } from "./expressions";
import { threadMinorDiameter, threadPresets, type Finish } from "./finishingTypes";
import { bodyOwners } from "./partTabs";
import type { FitSurface } from "./fitSurfaces";
import { barrelAxis, barrelEnd } from "./threadedCone";
import type { ThreadFrame } from "./threadMates";
import type { EvaluatedFeature, Feature, Project } from "./types";

type Thread = Extract<Finish, { kind: "thread" }>;
type End = Thread["end"];
type Side = Thread["side"];
type Rim = { outer: number; bore: number; centerline?: [number, number, number] };
type ThreadContext = {
  root: Feature;
  ownerId: string;
  axis: "X" | "Z";
  rims?: Record<End, Rim>;
  span?: number;
  socketEnd?: End;
};
const mm = (value: number) => Number(value.toFixed(4)) + " mm";

export function threadContext(project: Project, feature: Feature, evaluated: EvaluatedFeature[], surfaces?: FitSurface[]): ThreadContext {
  const owners = bodyOwners(project.features);
  const ownerId = owners.get(feature.id) ?? feature.id;
  const root = project.features.find(f => f.id === ownerId) ?? feature;
  const ctx: ThreadContext = { root, ownerId, axis: barrelAxis(root, surfaces) };
  const source = evaluated.find(f => f.id === ownerId);
  // Use the solved turning profile as a starting size. Preview checks the actual finished part.
  if (source?.kind === "revolve" && source.points.length > 2) {
    const xs = source.points.map(([x]) => x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const rim = (x: number): Rim => {
      const ds = source.points.filter(p => Math.abs(p[0] - x) < 1e-6).map(p => 2 * Math.abs(p[1]));
      return { outer: Math.max(...ds), bore: Math.min(...ds) };
    };
    ctx.rims = { start: rim(lo), end: rim(hi) };
    ctx.span = hi - lo;
  } else if (source?.kind === "extrude") ctx.span = Math.abs(source.amount);
  if (surfaces) {
    const start = barrelEnd(surfaces, ctx.axis, "start");
    const end = barrelEnd(surfaces, ctx.axis, "end");
    if (start && end) {
      ctx.rims = {
        start: { outer: start.outside, bore: start.bore, centerline: start.centerline },
        end: { outer: end.outside, bore: end.bore, centerline: end.centerline },
      };
      ctx.span = end.station - start.station;
    }
  }
  for (const step of project.features) {
    if (owners.get(step.id) !== ownerId || step.suppressed) continue;
    for (const finish of step.finishes ?? []) {
      if (!finish.suppressed && finish.kind === "hole" && finish.termination !== "through" &&
          (step.kind === "revolve" ? "X" : "Z") === ctx.axis) ctx.socketEnd = finish.end;
    }
  }
  return ctx;
}

function preferredEnd(ctx: ThreadContext, side: Side): End {
  if (side === "internal" && ctx.socketEnd) return ctx.socketEnd;
  const rims = ctx.rims;
  if (rims) {
    if (side === "internal" && Math.abs(rims.start.bore - rims.end.bore) > 1e-6)
      return rims.start.bore > rims.end.bore ? "start" : "end";
    if (Math.abs(rims.start.outer - rims.end.outer) > 1e-6)
      return rims.start.outer > rims.end.outer ? "start" : "end";
  }
  return side === "internal" ? "start" : "end";
}

export function threadPosition(ctx: ThreadContext, end: End) {
  return { preparationAxis: ctx.axis, preparationCenter: ctx.rims?.[end].centerline };
}

export function newAssistedThread(ctx: ThreadContext, initialSide?: Side): Partial<Thread> {
  const side = initialSide ?? (/\bcap\b|endcap/i.test(ctx.root.name) ? "internal" : "external");
  const end = preferredEnd(ctx, side);
  const rim = ctx.rims?.[end];
  // Start with a fine metric size that leaves a shoulder and clears the original bore.
  const candidates = threadPresets.filter(p => p.label.startsWith("M"))
    .map(p => ({ ...p, major: evaluate(p.diameter, {}), step: evaluate(p.pitch, {}) }))
    .sort((a,b) => b.major - a.major || a.step - b.step);
  const size = rim && candidates.find(p => p.major <= rim.outer - 0.5 &&
    threadMinorDiameter(p.major, p.step) > rim.bore + 0.1);
  const diameter = size?.diameter ?? (rim && rim.outer > rim.bore ? mm((rim.outer + rim.bore) / 2) : "8 mm");
  const pitch = size?.pitch ?? (rim && rim.outer > rim.bore ? mm(Math.min(.75, (rim.outer - rim.bore) / 5)) : "0.75 mm");
  const step = evaluate(pitch, {});
  const length = mm(Math.max(step, Math.min(4.5, step * 5, side === "internal" && ctx.span ? ctx.span * .6 : Infinity)));
  return { side, end, diameter, pitch, length, preset: size?.label ?? "Custom",
    preparation: side === "internal" ? "socket" : "tenon", ...threadPosition(ctx, end),
    name: side === "internal" ? "Threaded socket" : "Threaded tenon" };
}

function availableMates(project: Project, ownerId: string, frames: ThreadFrame[] | undefined) {
  const owners = bodyOwners(project.features);
  const choices: { key: string; label: string; finish: Thread }[] = [];
  function read(f: Feature, bodyName: string, bodyId: string) {
    if (f.suppressed) return;
    for (const finish of f.finishes ?? []) {
      if (finish.kind !== "thread" || finish.suppressed) continue;
      if (frames && !frames.some(ref => ref.featureId === f.id && ref.finishId === finish.id && ref.bodyId === bodyId)) continue;
      const size = finish.preset === "Custom" ? finish.diameter + " × " + finish.pitch : finish.preset;
      choices.push({ key: f.id + "/" + finish.id, label: bodyName + " · " + finish.name + " · " + size + (finish.side === "external" ? " · external" : " · internal"), finish });
    }
    for (const source of f.merge?.features ?? []) read(source, bodyName, bodyId);
  }
  for (const step of project.features) {
    const bodyId = owners.get(step.id);
    if (!bodyId || bodyId === ownerId) continue;
    const root = project.features.find(f => f.id === bodyId);
    if (root && !root.suppressed) read(step, root.name, bodyId);
  }
  return choices;
}

function PlacementDiagram({thread}: {thread: Thread}) {
  if (thread.preparation === "collar") return <svg viewBox="0 0 188 53" role="img" aria-label="Section of an external cap collar around the barrel bore">
    <g transform={thread.end === "end" ? "translate(188 0) scale(-1 1)" : undefined}>
      <path d="M18 17H170V36H18ZM18 22H170V31H18Z" fill="#46514f" fillRule="evenodd" stroke="#adb9b5"/>
      <path d="M18 17V10H68V17ZM18 36V43H68V36Z" fill="#aa8656" stroke="#edba76"/>
      {[22,30,38,46,54,62].map(x => <path key={x} d={`M${x} 10l3 4 3-4 M${x} 43l3-4 3 4`} stroke="#edba76" fill="none"/>)}
    </g>
  </svg>;
  const socket = thread.preparation === "socket";
  // Longitudinal half-section: hatching marks the threaded area. Mirror about the end of the part.
  const stock = socket ? "M50 7 H174 V46 H50 Z" : "M40 7 H91 L174 18 V35 L91 46 H40 Z";
  const material = socket ? "M50 18 H88 V35 H50 Z" : "M11 16 H40 V37 H11 Z";
  return <svg viewBox="0 0 188 53" role="img" aria-label={socket ? "Section of the cap with an inward threaded socket" : "Section of the cone with a projecting threaded tenon"}>
    <g transform={thread.end === "end" ? "translate(188 0) scale(-1 1)" : undefined}>
      <path d={stock} fill="#46514f" stroke="#adb9b5" />
      <path d={material} fill={socket ? "#191f21" : "#aa8656"} stroke="#edba76"/>
      {(socket ? [54,60,66,72,78,84] : [14,20,26,32,38]).map(x =>
        <path key={x} d={socket ? `M${x-2} 18 l2 -3 2 3 M${x-2} 35 l2 3 2 -3` : `M${x-2} 16 l2 4 2 -4 M${x-2} 37 l2 -4 2 4`} fill="none" stroke="#edba76"/>)}
      <path d="M3 26.5H185" stroke="#b1beb8" strokeDasharray="4 4" strokeWidth=".6"/>
    </g>
  </svg>;
}

export function ThreadSettings({ thread, feature, ctx, project, frames, values, focused, field, update }: {
  thread: Thread; feature: Feature; ctx: ThreadContext; project: Project; frames?: ThreadFrame[];
  values: Record<string, number>; focused: boolean;
  field: (label: string, key: string, value: string) => ReactNode;
  update: (patch: Partial<Thread>) => void;
}) {
  const choices = useMemo(() => availableMates(project, ctx.ownerId, frames), [project, ctx.ownerId, frames]);
  const [copiedKey, setCopiedKey] = useState("");
  const copied = choices.find(c => c.key === copiedKey)?.finish;
  const stillMatches = copied && copied.side !== thread.side && copied.preset === thread.preset &&
    copied.diameter === thread.diameter && copied.pitch === thread.pitch && copied.hand === thread.hand && copied.length === thread.length;
  const automaticName = ["Thread", "Threaded socket", "Threaded tenon"].includes(thread.name);
  function place(preparation: Thread["preparation"]) {
    const side = preparation === "tenon" || preparation === "collar" ? "external" : preparation === "socket" ? "internal" : thread.side;
    const name = preparation === "tenon" ? "Threaded tenon" : preparation === "socket" ? "Threaded socket" : "Thread";
    const end = side === thread.side ? thread.end : preferredEnd(ctx, side);
    update({ preparation, end, side,
      ...(preparation ? threadPosition(ctx, end) : { preparationAxis: undefined, preparationCenter: undefined }),
      ...(preparation !== "socket" ? { backWall: undefined } : {}),
      ...(automaticName ? { name } : {}) });
  }
  function copy(key: string) {
    setCopiedKey(key);
    const source = choices.find(c => c.key === key)?.finish;
    if (!source) return;
    const side = source.side === "internal" ? "external" : "internal";
    const preparation = thread.preparation && (side === "internal" ? "socket" : thread.preparation === "collar" ? "collar" : "tenon");
    update({ preset: source.preset, diameter: source.diameter, pitch: source.pitch, hand: source.hand, length: source.length,
      side, preparation, ...(side !== thread.side ? {
        end: preferredEnd(ctx, side), ...(preparation ? threadPosition(ctx, preferredEnd(ctx, side)) : {}),
      } : {}),
      ...(preparation === "tenon" ? { backWall: undefined } : {}),
      ...(preparation && automaticName ? { name: preparation === "socket" ? "Threaded socket" : "Threaded tenon" } : {}) });

  }
  const placement = thread.preparation;
  const axis = placement ? thread.preparationAxis ?? ctx.axis : feature.kind === "revolve" ? "X" : "Z";
  function endLabel(end: End) {
    let name = end === "start" ? "Start" : "End";
    if (placement && ctx.rims) {
      const rim = ctx.rims[end], other = ctx.rims[end === "start" ? "end" : "start"];
      if (placement === "socket" && rim.bore > 0 && other.bore === 0) name = "Open profile end";
      else if (placement === "socket" && rim.bore === 0 && other.bore > 0) name = "Closed profile end";
      else if (Math.abs(rim.outer - other.outer) > 1e-6) name = rim.outer > other.outer ? "Wider profile end" : "Narrower profile end";
    }
    return name + (end === "start" ? " · minimum " : " · maximum ") + axis;
  }
  let pilot: number | undefined;
  try {
    const d = evaluate(thread.diameter, values), p = evaluate(thread.pitch, values);
    const minor = threadMinorDiameter(d, p);
    if (d > 0 && p > 0 && minor > 0) pilot = minor;
  } catch { /* The inputs remain editable while typing an expression. */ }
  return <div className="thread-settings">
    <div className="two-cols">
      <label>Thread placement<select aria-label="Thread placement" value={placement ?? "existing"}
        onChange={e => place(e.target.value === "existing" ? undefined : e.target.value as Thread["preparation"])}>
        <option value="tenon">Add external tenon</option>
        <option value="socket">Cut internal socket</option>
        {placement === "collar" && <option value="collar">External cap collar</option>}
        <option value="existing">Use existing stock</option>
      </select></label>
      <label>End<select aria-label="End" value={thread.end} onChange={e => {
        const end = e.target.value as End;
        update({ end, ...(placement ? threadPosition(ctx, end) : {}) });
      }}>
        <option value="start">{endLabel("start")}</option>
        <option value="end">{endLabel("end")}</option>
      </select></label>
    </div>
    {placement && <div className="thread-placement-note">
      <PlacementDiagram thread={thread}/>
      <p>{placement === "tenon" ? "Extends the chosen end with a straight threaded shaft. A center bore continues through the shaft."
        : placement === "collar" ? "Adds the outside cap thread around the barrel behind the end face. The bore and cone socket pass through the collar."
        : "Cuts a straight threaded socket into the chosen end. The cap opening sits at the selected face."}</p>
    </div>}
    {choices.length > 0 && <label>Copy mating thread<select aria-label="Copy mating thread" value={stillMatches ? copiedKey : ""} onChange={e => copy(e.target.value)}>
      <option value="">Choose a thread on another part…</option>
      {choices.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
    </select><small>Uses the opposite thread surface and copies the size, pitch, length and hand.</small></label>}
    <div className="two-cols">
      <label>Thread size<select aria-label="Thread size" value={thread.preset}
        onChange={e => {
          const preset = threadPresets.find(p => p.label === e.target.value);
          update(preset ? { preset: preset.label, diameter: preset.diameter, pitch: preset.pitch } : { preset: "Custom" });
        }}>
        <option>Custom</option>
        {threadPresets.map(p => <option key={p.label}>{p.label}</option>)}
      </select></label>
      {field("Threaded length", "length", thread.length)}
    </div>
    {(!focused || thread.preset === "Custom") && <div className="two-cols">
      {field("Major diameter", "diameter", thread.diameter)}
      {field("Pitch", "pitch", thread.pitch)}
    </div>}
    {placement === "socket" && <div className="thread-back-wall">
      <label className="thread-back-toggle"><input type="checkbox" checked={thread.backWall !== undefined}
        onChange={e => update({ backWall: e.target.checked ? "1.5 mm" : undefined })}/>Close back of barrel</label>
      {thread.backWall !== undefined && <>{field("Back wall thickness", "backWall", thread.backWall)}
        <small>The opposite end closes inward. The overall part length stays the same.</small></>}
    </div>}
    {!placement && <label>Surface<select aria-label="Surface" value={thread.side}
      onChange={e => update({ side: e.target.value as Side })}>
      <option value="external">External shaft</option><option value="internal">Internal bore</option>
    </select></label>}
    <div className="two-cols">
      <label>Geometry<select aria-label="Geometry" value={thread.mode} onChange={e => update({ mode: e.target.value as Thread["mode"] })}>
        <option value="modeled">Modeled helix</option><option value="cosmetic">Cosmetic guide</option>
      </select></label>
      <label>Hand<select aria-label="Hand" value={thread.hand} onChange={e => update({ hand: e.target.value as Thread["hand"] })}>
        <option value="right">Right-hand</option><option value="left">Left-hand</option>
      </select></label>
    </div>
    {placement === "socket" && pilot !== undefined && <p className="thread-pilot">Modeled pilot diameter <strong>Ø{mm(pilot)}</strong></p>}
    <p className="helper">{thread.mode === "cosmetic" ? placement
      ? "STEP and STL include the prepared solid. The helical guide is visible in Turnmill."
      : "The guide appears in Turnmill. STEP and STL retain the original smooth solid."
      : "The major diameter and pitch drive the single-start 60° thread cut in STEP and STL."}</p>
  </div>;
}
