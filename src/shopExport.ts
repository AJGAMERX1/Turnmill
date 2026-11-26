import type { EvaluatedFeature } from "./types";
import type { ThreadFrame } from "./threadMates";

export type ShopPart = { bodyId: string; item: number; name: string; material: string; purchased: boolean; appearance?: string; drawing?: { number: string; revision: string; tolerance?: string; note?: string } };
export type PackageFormats = { models: boolean; printModels: boolean; drawings: boolean; assemblyDrawing: boolean };
export type DeliveryRequest = PackageFormats & { name: string; parts: ShopPart[] };
export const assemblyDrawingPath = "Drawings/Assembly.pdf";

const cleanLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
const mm = (n: number) => Number(n.toFixed(6)) + " mm";

export function packageFilenameStem(value: string) {
  const name = cleanLine(value).normalize("NFC").replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+|[. ]+$/g, "");
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? "_" + name : name;
  return [...(safe || "Turnmill")].slice(0, 80).join("").trimEnd();
}

export type SingleExportFormat = "step" | "stl" | "3mf" | "turnmill";

export function singleExportFilename(name: string, format: SingleExportFormat) {
  const extension = format === "turnmill" ? /\.turnmill$/i : /\.(step|stl|3mf|zip)$/i;
  return packageFilenameStem(name.replace(extension, "") || "Part") + "." + format;
}

export function shopPaths(part: ShopPart) {
  const stem = String(part.item).padStart(2, "0") + "-" + [...packageFilenameStem(part.name || "Part")].slice(0, 45).join("");
  return { model: "Parts/" + stem + ".step", print: "Print/" + stem + ".3mf", drawing: "Drawings/" + stem + ".pdf" };
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

export function shopPartsCsv(parts: ShopPart[], formats: PackageFormats) {
  const rows = [["Item", "Part", "Quantity", "Material", "Source", "Surface appearance", "Drawing number", "Revision", "STEP file", "3MF file", "Drawing file"]];
  for (const part of parts) {
    const paths = shopPaths(part);
    rows.push([String(part.item), part.name, "1", part.material, part.purchased ? "Purchased reference" : "Manufactured",
      part.appearance ?? "", part.drawing?.number ?? "", part.drawing?.revision ?? "",
      formats.models ? paths.model : "", formats.printModels ? paths.print : "", formats.drawings ? paths.drawing : ""]);
  }
  return rows.map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\r\n") + "\r\n";
}

export function shopManifest(projectName: string, parts: { part: ShopPart; features: EvaluatedFeature[]; frames: ThreadFrame[] }[], formats: PackageFormats) {
  const lines = [cleanLine(projectName), "CNC shop package", "Dimensions are in millimetres (mm)."];
  if (formats.models && parts.length) lines.push("Parts/ contains an exact STEP solid in local coordinates for each selected part.");
  if (formats.printModels && parts.length) lines.push("Print/ contains a 3MF mesh in millimetres for each selected part.");
  if (formats.drawings && parts.length) lines.push("Drawings/ contains a vector PDF for each selected part.");
  if (formats.assemblyDrawing) lines.push(assemblyDrawingPath + " shows the complete assembly at its home position.");
  lines.push("Parts list.csv lists the selected components. Confirm alloy, tolerances, thread class and surface finish on the approved drawing.", "");
  for (const { part, features, frames } of parts) {
    const paths = shopPaths(part);
    lines.push("Item " + part.item + " · " + cleanLine(part.name) + " | Qty 1 | " + cleanLine(part.material) +
      (part.purchased ? " | Purchased reference" : " | Manufactured part"));
    if (formats.models) lines.push("  " + paths.model);
    if (formats.printModels) lines.push("  " + paths.print);
    if (formats.drawings) lines.push("  " + paths.drawing);
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
