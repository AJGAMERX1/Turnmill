import type { EvaluatedFeature } from "./types";
import type { ThreadFrame } from "./threadMates";

export type ShopPart = { bodyId: string; item: number; name: string; material: string; purchased: boolean; appearance?: string; drawing?: { number: string; revision: string; tolerance?: string; note?: string } };
export type ShopPackage = { projectName: string; parts: ShopPart[] };

const cleanLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
const mm = (n: number) => Number(n.toFixed(6)) + " mm";

export function shopStepFilename(part: ShopPart) {
  const name = cleanLine(part.name).normalize("NFC").replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+|[. ]+$/g, "");
  // The stable BOM item distinguishes duplicate and case-insensitive names on shop PCs.
  return String(part.item).padStart(2, "0") + "-" + ([...(name || "Part")].slice(0, 45).join("")) + ".step";
}

function threadNotes(features: EvaluatedFeature[], frames: ThreadFrame[]) {
  const notes: string[] = [];
  const visit = (f: EvaluatedFeature) => {
    f.merge?.features.forEach(visit);
    for (const t of f.finishes ?? []) {
      if (t.kind !== "thread" || t.suppressed) continue;
      const frame = frames.find(x => x.featureId === f.id && x.finishId === t.id);
      const location = frame ? frame.end + " of " + frame.axis + ", entrance (" +
        frame.entrance.map(n => Number(n.toFixed(4))).join(", ") + ") mm" : "source feature " + cleanLine(f.name) + ", " + t.end;
      const geometry = t.mode === "modeled" ? "modeled helical geometry" : "cosmetic, machine grooves to callout";
      notes.push(cleanLine(t.name) + " — " + t.side + ", " + t.hand + "-hand, " + location +
        ". Preset " + cleanLine(t.preset || "custom") + ", design major Ø" + mm(t.diameter) + ", pitch " + mm(t.pitch) +
        ", length " + mm(t.length) + ". " + geometry + ".");
    }
  };
  features.forEach(visit);
  return notes;
}

export function shopManifest(projectName: string, parts: { part: ShopPart; features: EvaluatedFeature[]; frames: ThreadFrame[] }[]) {
  const lines = [cleanLine(projectName), "CNC shop package", "Dimensions are in millimetres (mm). Each STEP uses the part's local coordinates.",
    "Material and thread data come from the Turnmill model. Confirm alloy, tolerances, thread class and surface finish on the approved drawing.", ""];
  for (const { part, features, frames } of parts) {
    lines.push(shopStepFilename(part), cleanLine(part.name) + " | Qty 1 | " + cleanLine(part.material) +
      (part.purchased ? " | Purchased reference" : " | Manufactured part"));
    if (part.appearance) lines.push("  Surface appearance reference · " + cleanLine(part.appearance));
    if (part.drawing) {
      const { number, revision, tolerance, note } = part.drawing;
      lines.push("  Drawing " + cleanLine(number) + " · revision " + cleanLine(revision));
      if (tolerance) lines.push("  General linear tolerance " + cleanLine(tolerance));
      if (note) lines.push("  " + cleanLine(note));
    }
    const notes = threadNotes(features, frames);
    if (notes.length) lines.push(...notes.map(line => "  " + line));
    lines.push("");
  }
  return lines.join("\n");
}
