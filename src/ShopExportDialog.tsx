import { useState } from "react";
import { Download } from "lucide-react";
import { drawingSources, partSheetKey } from "./drawingSheetSettings";
import { evaluate, resolveParameters } from "./expressions";
import { assemblyParts } from "./AssemblyBom";
import { Modal } from "./Dialogs";
import type { Project, EvaluatedFeature } from "./types";
import { anodizedColors, bodyMaterialName, isMetal, metalFinishNames, readSurface } from "./metalAppearance";
import type { ShopPart } from "./shopExport";

function surfaceReference(project: Project, id: string) {
  const material = bodyMaterialName(project, id);
  if (!isMetal(material)) return;
  const { finish, anodize } = readSurface(project, id);
  const descriptions: string[] = finish ? [metalFinishNames[finish]] : [];
  if (anodize && material === "Aluminum") {
    const name = Object.entries(anodizedColors).find(([, hex]) => hex.toLowerCase() === anodize.toLowerCase())?.[0] ?? "Custom";
    descriptions.push(name + " anodizing (sRGB " + anodize.toUpperCase() + ")");
  }
  return descriptions.join(" · ") || undefined;
}

export default function ShopExportDialog({ project, features, ready, onClose, onExport }: {
  project: Project; features: EvaluatedFeature[]; ready: boolean; onClose: () => void; onExport: (parts: ShopPart[]) => void;
}) {
  const books = drawingSources(project.workspaces?.drawing ?? {}, features.find(f => f.operation === "new")?.id);
  const parts: ShopPart[] = assemblyParts(project, features).map(({ bodyId, item, name, material }) => {
    const sheet = books[partSheetKey(bodyId)];
    let tolerance: string | undefined;
    if (sheet?.tolerance?.trim()) {
      try {
        const value = evaluate(sheet.tolerance, resolveParameters(project.parameters));
        if (value < 0) throw Error();
        tolerance = "±" + value + " mm";
      } catch { tolerance = "requires review on the drawing"; }
    }
    return { bodyId, item, name, appearance: surfaceReference(project, bodyId), material: sheet?.material?.trim() || material, purchased: !!(project.workspaces?.hardwareComponents?.[bodyId] ||
      project.workspaces?.refills?.[bodyId] || bodyId === "pen-refill" && project.features.some(f => f.id === "pen-refill" && f.sketchId === "pen-refill-profile")),
      drawing: { number: sheet?.number || "TM-" + String(item).padStart(3, "0"), revision: sheet?.revision ?? "A", tolerance, note: sheet?.note } };
  });
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const chosen = parts.filter(p => overrides[p.bodyId] ?? !p.purchased);
  return <Modal title="CNC shop package" onClose={onClose}>
    <p className="shop-intro">Choose parts for machining. Each gets a separate STEP file in millimetres. The manifest lists materials, selected finishes and thread callouts.</p>
    <div className="shop-parts">
      {parts.map(p => <label key={p.bodyId}>
        <input type="checkbox" aria-label={p.name + " · item " + p.item} checked={overrides[p.bodyId] ?? !p.purchased}
          onChange={e => setOverrides(current => ({ ...current, [p.bodyId]: e.target.checked }))}/>
        <span>{p.name}<small>Item {p.item} · {p.material}{p.appearance && " · " + p.appearance}{p.purchased && " · Purchased reference"}</small></span>
      </label>)}
    </div>
    <div className="dialog-actions"><button className="outline-btn" onClick={onClose}>Cancel</button>
      <button className="primary" disabled={!ready || !chosen.length} onClick={() => onExport(chosen)}>
        <Download size={15}/> Download ZIP ({chosen.length})</button></div>
  </Modal>;
}
