import { useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { assemblyItemNumbers } from "./assemblyItems";
import { materials } from "./materials";
import { anodizedColors, bodyMaterialName, isMetal, metalFinishNames, readSurface, setBodySurface, type MetalFinish } from "./metalAppearance";
import type { EvaluatedFeature, Project } from "./types";

const swatch = (color: string) => ({ "--sample": color } as CSSProperties);
const hex = (value: number) => "#" + value.toString(16).padStart(6, "0");

function CustomAnodizing({ value, apply }: { value: string; apply: (hexCode: string) => void }) {
  const [draft, setDraft] = useState(value);
  const valid = /^#[0-9a-f]{6}$/i.test(draft);
  return <details className="appearance-custom">
    <summary>Custom color</summary>
    <form onSubmit={e => { e.preventDefault(); if (valid) apply(draft); }}>
      <input type="color" aria-label="Choose custom color" value={valid ? draft : value} onChange={e => setDraft(e.target.value)}/>
      <input type="text" aria-label="Hex color" spellCheck={false} value={draft} maxLength={7}
        placeholder="#RRGGBB" onChange={e => setDraft(e.target.value)} aria-invalid={!valid}/>
      <button type="submit" disabled={!valid}>Apply color</button>
    </form>
  </details>;
}

export default function PenAppearancePanel({ project, bodies, preferredId, commit }: {
  project: Project; bodies: EvaluatedFeature[]; preferredId?: string; commit: (p: Project) => Project;
}) {
  const [choice, choose] = useState("");
  if (!bodies.length) return null;
  const numbers = assemblyItemNumbers(project);
  const barrelId = project.workspaces?.boltPen?.barrelId ??
    Object.values(project.workspaces?.capMounts ?? {}).find((m): m is { barrelId: string } =>
      !!m && typeof m === "object" && "barrelId" in m && typeof m.barrelId === "string")?.barrelId ??
    bodies.find(f => /barrel/i.test(f.name))?.id;
  const body = [choice, preferredId, barrelId].map(id => bodies.find(f => f.id === id)).find(Boolean) ?? bodies[0];
  const material = bodyMaterialName(project, body.id);
  const surface = readSurface(project, body.id);
  const metallic = isMetal(material);
  const tint = material === "Aluminum" ? surface.anodize : undefined;
  const tintName = Object.entries(anodizedColors).find(([, color]) => color.toLowerCase() === tint?.toLowerCase())?.[0];
  const baseColor = hex(materials[material].color);
  const finishOptions = Object.entries(metalFinishNames) as [MetalFinish, string][];
  function changeMetal(name: string) {
    if (name === material) return;
    const bodyDensities = { ...project.workspaces?.bodyDensities };
    delete bodyDensities[body.id];
    commit({ ...project, workspaces: { ...project.workspaces, bodyDensities,
      bodyMaterials: { ...project.workspaces?.bodyMaterials, [body.id]: name } } });
  }
  function dye(color?: string) {
    commit(setBodySurface(project, body.id, { ...surface, anodize: color }));
  }
  return <section aria-label="Appearance" id="studio-appearance" className="pen-appearance">
    <h3>Appearance</h3>
    <label>Part to finish<select id="appearance-part" aria-label="Part to finish" value={body.id} onChange={e => choose(e.target.value)}>
      {bodies.map(b => <option key={b.id} value={b.id}>{b.name}{bodies.some(o => o !== b && o.name === b.name) && " · Item " + numbers[b.id]}</option>)}
    </select></label>
    <fieldset className="appearance-swatches"><legend>Base material <strong>{material}</strong></legend>
      <div>{Object.entries(materials).map(([name, definition]) =>
        <button key={name} type="button" title={name} style={swatch(hex(definition.color))} aria-pressed={material === name}
          aria-label={body.id === barrelId ? name + " barrel" : name + " for " + body.name} onClick={() => changeMetal(name)}>
          {material === name && <Check size={13} strokeWidth={3}/>}
        </button>)}</div>
    </fieldset>
    {metallic && <fieldset className="appearance-textures"><legend>Surface texture</legend>
      <div>{finishOptions.map(([finish, label]) => <button key={finish} type="button" aria-pressed={finish === (surface.finish ?? "polished")}
        onClick={() => commit(setBodySurface(project, body.id, { ...surface, finish }))}>
        <span aria-hidden="true" data-texture={finish} style={swatch(tint ?? baseColor)}/>{label}
      </button>)}</div>
    </fieldset>}
    {material === "Aluminum" && <fieldset className="appearance-swatches appearance-dyes">
      <legend>Anodizing color <strong>{tintName ?? (tint ? tint.toUpperCase() : "Bare")}</strong></legend>
      <div>
        <button type="button" aria-label="Bare aluminum" title="Bare aluminum" style={swatch(baseColor)}
          aria-pressed={!tint} onClick={() => dye()}>{!tint && <Check size={13} strokeWidth={3}/>}</button>
        {Object.entries(anodizedColors).map(([name, color]) => <button key={name} type="button" title={name}
          aria-label={name + " anodizing"} style={swatch(color)} aria-pressed={name === tintName} onClick={() => dye(color)}>
          {name === tintName && <Check size={13} strokeWidth={3}/>}</button>)}
      </div>
      <CustomAnodizing key={body.id + "/" + (tint ?? "")} value={tint ?? baseColor} apply={dye}/>
    </fieldset>}
  </section>;
}
