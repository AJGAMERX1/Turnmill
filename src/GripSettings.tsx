import type { ReactNode } from "react";
import type { Finish } from "./finishingTypes";
import type { EvaluatedFeature } from "./types";

type Grip = Extract<Finish, { kind: "grip" }>;
const mm = (n: number) => Number(n.toFixed(5)) + " mm";

/** Start a band on an exterior straight span of the turned stock; the kernel checks the finished solid. */
export function initialGripBand(profile?: EvaluatedFeature) {
  const defaults = { offset: "2 mm", length: "10 mm", width: "0.6 mm", depth: "0.18 mm" };
  if (profile?.kind !== "revolve" || profile.points.length < 3) return defaults;
  const points = profile.points;
  const edges = points.map((a, i) => ({ a, b: points[(i + 1) % points.length], curve: profile.edges?.[i]?.through }));
  const minX = Math.min(...points.map(([x]) => x));
  let best: { start: number; length: number; radius: number } | undefined;
  for (const { a, b, curve } of edges) {
    const span = Math.abs(b[0] - a[0]), radius = Math.abs(a[1]);
    if (curve || Math.abs(a[1] - b[1]) > 1e-6 || span < 0.01 || radius < 0.01) continue;
    const mid = (a[0] + b[0]) / 2;
    const internal = edges.some(({ a, b }) => {
      if (mid <= Math.min(a[0],b[0]) || mid >= Math.max(a[0],b[0])) return false;
      const y = a[1] + (b[1] - a[1]) * (mid - a[0]) / (b[0] - a[0]);
      return Math.abs(y) > radius + 1e-6;
    });
    if (!internal && (!best || span > best.length))
      best = { start: Math.min(a[0],b[0]), length: span, radius };
  }
  if (!best) return defaults;
  const margin = Math.min(2, best.length / 8);
  const length = Math.min(10, best.length - 2 * margin);
  return {
    offset: mm(best.start - minX + margin), length: mm(length),
    width: mm(Math.min(.6, length / 12, best.radius / 2)),
    depth: mm(Math.min(.18, best.radius / 12, length / 25)),
  };
}

const patterns = [
  { value: "rings", label: "Rings", hint: "Ring grooves circle the barrel across the length of the grip." },
  { value: "flutes", label: "Flutes", hint: "Flutes run lengthwise and repeat around the barrel." },
  { value: "crosscut", label: "Cross-cut", hint: "Crossing rings and flutes leave raised pads. The count sets both rows and columns." },
] as const;

export function GripSettings({ grip, update, field }: {
  grip: Grip;
  update: (patch: Partial<Grip>) => void;
  field: (label: string, key: string, value: string) => ReactNode;
}) {
  return <div className="grip-settings">
    <fieldset className="grip-patterns">
      <legend>Grip pattern</legend>
      <div>{patterns.map(({ value, label }) =>
        <button type="button" key={value} aria-pressed={grip.style === value}
          onClick={() => update({ style: value })}>
          <span aria-hidden="true" className={"grip-sample grip-sample-" + value}/>
          {label}
        </button>)}</div>
      <p>{patterns.find(p => p.value === grip.style)?.hint}</p>
    </fieldset>
    <div className="two-cols">
      {field("Groove count", "count", grip.count)}
      {field("Band length", "length", grip.length)}
      {field("Groove width", "width", grip.width)}
      {field("Cut depth", "depth", grip.depth)}
    </div>
    <div className="two-cols">
      <label>Measure from
        <select aria-label="Measure from" value={grip.end} onChange={e => update({end:e.target.value as Grip["end"]})}>
          <option value="start">Start · minimum X</option>
          <option value="end">End · maximum X</option>
        </select>
      </label>
      {field("Offset from end", "offset", grip.offset)}
    </div>
  </div>;
}
