import { useId, type ReactNode } from "react";
import { evaluate } from "./expressions";
import type { Finish } from "./finishingTypes";
import type { GripBand, GripStock } from "./gripBands";

type Grip = Extract<Finish, { kind: "grip" }>;
const display = (n: number) => Number(n.toFixed(3));
const mm = (n: number) => Number(n.toFixed(6)) + " mm";
const span = (b: GripBand) => b.end - b.start;
const isTaper = (b: GripBand) => Math.abs(b.endRadius - b.startRadius) > 1e-6;
function lengthOf(expr: string, values: Record<string, number>) {
  try { return evaluate(expr, values); } catch { return NaN; }
}
function bandRange(grip: Grip, stock: GripStock | undefined, values: Record<string, number>): [number, number] | undefined {
  if (!stock) return;
  const length = lengthOf(grip.length, values), offset = lengthOf(grip.offset, values);
  if (!(length > 0) || !Number.isFinite(offset)) return;
  const x = grip.end === "start" ? stock.minX + offset : stock.maxX - offset - length;
  return [x, x + length];
}

/** Prefer the least movement that preserves a user's length. For a new grip, use the longest land. */
function preferredBand(stock: GripStock, range?: [number, number]) {
  const distance = (b: GripBand) => range ? Math.max(0, b.start - range[0], range[1] - b.end) : 0;
  const length = range ? range[1] - range[0] : 0;
  const possible = stock.bands.filter(b => span(b) >= length - 1e-6);
  const pool = possible.length ? possible : stock.bands;
  return [...pool].sort((a,b) => (possible.length ? distance(a) - distance(b) : 0) || span(b) - span(a))[0];
}

function fitGrip(grip: Grip, stock: GripStock, band: GripBand, values: Record<string, number>, initial = false) {
  const wanted = lengthOf(grip.length, values);
  const margin = Math.min(2, span(band) / 8);
  const keepLength = wanted > 0 && wanted <= span(band) + 1e-7;
  const length = keepLength ? Math.min(wanted, span(band)) : span(band) - 2 * margin;
  const inset = Math.min(margin, Math.max(0, (span(band) - length) / 2));
  const range = bandRange(grip, stock, values);
  const first = band.start + inset, last = band.end - length - inset;
  const x = initial || !range ? (grip.end === "start" ? first : last)
    : Math.min(Math.max(range[0], first), Math.max(first, last));
  const offset = grip.end === "start" ? x - stock.minX : stock.maxX - x - length;
  const patch: Partial<Grip> = { offset: mm(Math.max(0, offset)) };
  if (!keepLength) patch.length = mm(length);
  if (initial) {
    const slope = (band.endRadius - band.startRadius) / span(band);
    const radius = band.startRadius + slope * (x - band.start + (slope < 0 ? length : 0));
    patch.width = mm(Math.min(.6, length / 12, radius / 2));
    patch.depth = mm(Math.min(.18, radius / 12, length / 25));
  }
  return patch;
}

export function initialGripBand(grip: Grip, stock: GripStock, values: Record<string, number>) {
  const best = preferredBand(stock);
  return best && fitGrip(grip, stock, best, values, true);
}

function BandDiagram({stock, range, fits}: {stock: GripStock; range?: [number,number]; fits: boolean}) {
  const clipId = useId();
  const scale = (x: number) => 2 + 296 * (x - stock.minX) / (stock.maxX - stock.minX);
  const maxRadius = Math.max(...stock.bands.map(b => Math.max(b.startRadius, b.endRadius)), 1e-6);
  const sections = stock.bands.map(b => {
    const left = scale(b.start), right = scale(b.end);
    const r1 = 13 * b.startRadius / maxRadius, r2 = 13 * b.endRadius / maxRadius;
    return `M${left} ${18-r1} L${right} ${18-r2} V${18+r2} L${left} ${18+r1} Z`;
  }).join(" ");
  return <svg className="grip-band-diagram" role="img" aria-label="Barrel surfaces and requested grip band, viewed from the side" viewBox="0 0 300 36">
    <defs><clipPath id={clipId}><path d={sections}/></clipPath></defs>
    <path d="M2 18H298" stroke="#65706e" strokeDasharray="3 3"/>
    <path d={sections} fill="#56605e" stroke="#a4aeaa" strokeWidth=".8"/>
    {range && <g fill={fits ? "#efb969" : "#ff9b71"}>
      <rect x={scale(range[0])} y="2" width={scale(range[1])-scale(range[0])} height="32" clipPath={`url(#${clipId})`} />
      <path d={`M${scale(range[0])} 2v32 M${scale(range[1])} 2v32`} stroke="currentColor"/>
    </g>}
  </svg>;
}

const patterns = [
  { value: "rings", label: "Rings", hint: "Ring grooves circle the barrel across the length of the grip." },
  { value: "flutes", label: "Flutes", hint: "Flutes run lengthwise and repeat around the barrel." },
  { value: "crosscut", label: "Cross-cut", hint: "Crossing rings and flutes leave raised pads. The count sets both rows and columns." },
] as const;

export function GripSettings({ grip, update, field, stock, values, stockMessage }: {
  grip: Grip;
  stock?: GripStock;
  values: Record<string, number>;
  stockMessage?: string;
  update: (patch: Partial<Grip>) => void;
  field: (label: string, key: string, value: string) => ReactNode;
}) {
  const range = bandRange(grip, stock, values);
  const fits = stock?.bands.find(b => range && b.start <= range[0] + 1e-6 && b.end >= range[1] - 1e-6);
  const best = stock && preferredBand(stock, range);
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
    {stockMessage ? <p className="grip-stock-note" role="status">{stockMessage}</p> : stock &&
      <section className="grip-placement" aria-label="Grip placement">
        <div className="grip-placement-heading"><strong>Band placement</strong>
          {best && <button type="button" onClick={() => update(fitGrip(grip, stock, best, values))}>Fit to surface</button>}
        </div>
        {stock.bands.length ? <>
          <BandDiagram stock={stock} range={range} fits={!!fits}/>
          <p className={range && !fits ? "grip-placement-warning" : undefined}>
            {range ? `${display(range[0] - stock.minX)}–${display(range[1] - stock.minX)} mm from the start. ` : "Enter a band length and offset. "}
            {range && (fits ? (isTaper(fits) ? "On a tapered surface." : "On a cylindrical surface.") : "The band extends beyond a single surface.")}
          </p>
          {stock.bands.length > 1 &&
            <label>Barrel surface
              <select aria-label="Barrel surface" value={fits ? stock.bands.indexOf(fits) : ""} onChange={e => {
                const band = stock.bands[Number(e.target.value)];
                if (band) update(fitGrip(grip, stock, band, values));
              }}>
                {!fits && <option value="" disabled>Choose a surface</option>}
                {stock.bands.map((b, i) => <option key={i} value={i}>
                  {isTaper(b) ? "Taper" : "Cylinder"} · {display(b.start - stock.minX)}–{display(b.end - stock.minX)} mm
                </option>)}
              </select>
            </label>}
        </> : <p>This part needs an uninterrupted cylinder or straight-sided taper around the X axis for a grip.</p>}
      </section>}
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
