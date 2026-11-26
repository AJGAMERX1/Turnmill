import type { SlimSettings } from "./slimSizing";

export default function SlimSizeInputs({ settings, disabled, onChange }: {
  settings: SlimSettings; disabled: boolean; onChange: (value: Partial<SlimSettings>) => void;
}) {
  return <>
    <label>Sizing method<select id="slim-pen-method" disabled={disabled} value={settings.method} onChange={e => onChange({ method: e.target.value as SlimSettings["method"] })}>
      <option value="diameter">Diameter allowance</option><option value="wall">Minimum wall</option>
    </select></label>
    {settings.method === "diameter" ? <><label>Diameter allowance<input value={settings.allowance} disabled={disabled} onChange={e => onChange({ allowance: e.target.value })}/></label>
      <p>Adds to the widest refill diameter. A 1 mm allowance adds 0.5 mm per side before bore clearance.</p></>
      : <><label>Minimum wall<input value={settings.wall} disabled={disabled} onChange={e => onChange({ wall: e.target.value })}/></label>
        <p>Sets the material to keep on each side of the bore. The preview also accounts for the parts that fit around it.</p></>}
    <details><summary>Machining allowances</summary>
      <label>Running clearance<input disabled={disabled} value={settings.runningClearance} onChange={e => onChange({ runningClearance: e.target.value })}/></label>
      <p>Added to the refill diameter for the barrel bore.</p>
      {settings.method === "diameter" && <label>Minimum radial wall<input disabled={disabled} value={settings.wallFloor} onChange={e => onChange({ wallFloor: e.target.value })}/></label>}
    </details>
  </>;
}
