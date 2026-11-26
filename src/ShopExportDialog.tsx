import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, Check, CheckCheck, ChevronDown, CircleAlert, File, FileArchive,
  FileBox, FileText, Files, Folder, ListTree, LoaderCircle,
  Package, ScrollText, Sheet, SquarePen,
} from "lucide-react";
import { assemblyParts } from "./AssemblyBom";
import { Modal } from "./Dialogs";
import { drawingSources, partSheetKey } from "./drawingSheetSettings";
import { evaluate, resolveParameters } from "./expressions";
import { anodizedColors, bodyMaterialName, isMetal, metalFinishNames, readSurface } from "./metalAppearance";
import { assemblyDrawingPath, packageFilenameStem, shopPaths, singleExportFilename, type DeliveryRequest, type ShopPart, type SingleExportFormat } from "./shopExport";
import type { EvaluatedFeature, Project } from "./types";
import "./shopExportDialog.css";

export type ExportPreset = "package" | "drawings" | "single";
type DialogProps = {
  project: Project;
  features: EvaluatedFeature[];
  ready: boolean;
  selectedBodyId?: string;
  assemblyView?: boolean;
  initialPreset?: ExportPreset;
  exportScope: string;
  onScopeChange: (scope: string) => void;
  onClose: () => void;
  onExport: (request: DeliveryRequest, progress: (message: string) => void, signal: AbortSignal) => Promise<void>;
  onSingle: (format: SingleExportFormat, scope: string) => Promise<void> | void;
  onOpenDrawing?: (bodyId: string) => void;
};
type ExportState = { kind: "idle" | "working" | "complete" | "error"; message: string };
const idle: ExportState = { kind: "idle", message: "" };
const presets = [
  { id: "package", name: "Production package", hint: "Models & drawings", Icon: Package },
  { id: "drawings", name: "Drawings", hint: "PDF sheet package", Icon: ScrollText },
  { id: "single", name: "Single file", hint: "Model or project", Icon: FileBox },
] as const;
const fileFormats: { id: SingleExportFormat; label: string; detail: string }[] = [
  { id: "step", label: "STEP solid", detail: "Exact solid geometry for CAD and CAM." },
  { id: "stl", label: "STL mesh", detail: "Triangulated surface mesh in millimetres." },
  { id: "3mf", label: "3MF model", detail: "Unit-aware mesh for a 3D slicer." },
  { id: "turnmill", label: "Native project", detail: "Editable sketches, parameters, part history and assembly settings." },
];

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

function exportParts(project: Project, features: EvaluatedFeature[]): ShopPart[] {
  const books = drawingSources(project.workspaces?.drawing ?? {}, features.find(f => f.operation === "new")?.id);
  return assemblyParts(project, features).map(({ bodyId, item, name, material }) => {
    const sheet = books[partSheetKey(bodyId)];
    let tolerance: string | undefined;
    if (sheet?.tolerance?.trim()) {
      try {
        const value = evaluate(sheet.tolerance, resolveParameters(project.parameters));
        if (value < 0) throw Error();
        tolerance = "±" + value + " mm";
      } catch { tolerance = "requires review on the drawing"; }
    }
    const purchased = Boolean(project.workspaces?.hardwareComponents?.[bodyId] || project.workspaces?.refills?.[bodyId] ||
      bodyId === "pen-refill" && project.features.some(f => f.id === bodyId && f.sketchId === "pen-refill-profile"));
    return { bodyId, item, name, purchased, appearance: surfaceReference(project, bodyId), material: sheet?.material?.trim() || material,
      drawing: { number: sheet?.number ?? "TM-" + String(item).padStart(3, "0"), revision: sheet?.revision ?? "A", tolerance, note: sheet?.note } };
  });
}

function FileGroup({ label, paths }: { label: string; paths: string[] }) {
  if (!paths.length) return null;
  return <details className="delivery-file-group" open>
    <summary><ChevronDown size={12}/><Folder size={15}/><strong>{label}</strong><span>{paths.length}</span></summary>
    <ul>{paths.map(path => <li key={path} title={path}><File size={13}/><span>{path.slice(path.lastIndexOf("/") + 1)}</span></li>)}</ul>
  </details>;
}

export default function ShopExportDialog({ project, features, ready, selectedBodyId, assemblyView, initialPreset = "package",
  exportScope, onScopeChange, onClose, onExport, onSingle, onOpenDrawing }: DialogProps) {
  const parts = useMemo(() => exportParts(project, features), [project, features]);
  const [preset, setPreset] = useState<ExportPreset>(initialPreset);
  const [files, setFiles] = useState({ models: true, printModels: true, drawings: true, assemblyDrawing: true });
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [customName, setCustomName] = useState<string>();
  const [singleFormat, setSingleFormat] = useState<SingleExportFormat>(parts.length ? "step" : "turnmill");
  const [status, setStatus] = useState<ExportState>(idle);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => { running.current?.abort(); }, []);
  const busy = status.kind === "working";
  const single = preset === "single";
  const native = single && singleFormat === "turnmill";
  const chosen = parts.filter(p => !excluded.has(p.bodyId));
  const name = customName ?? project.name + (preset === "drawings" ? " - Drawings" : " - CNC");
  const stem = packageFilenameStem(name.trim().replace(/\.zip$/i, ""));
  const models = preset === "package" && files.models;
  const printModels = preset === "package" && files.printModels;
  const partSheets = files.drawings;
  const assembly = parts.length > 1 && files.assemblyDrawing;
  const singlePart = exportScope.startsWith("part:") ? parts.find(p => p.bodyId === exportScope.slice(5))
    : exportScope === "selected" ? parts.find(p => p.bodyId === selectedBodyId) : undefined;
  const invalidScope = !native && single && exportScope !== "all" && !singlePart;
  const source = native || !singlePart ? project.name : singlePart.name;
  const outputName = single ? singleExportFilename(source, singleFormat) : stem + ".zip";
  const paths = chosen.map(shopPaths);
  const pdfPaths = partSheets ? paths.map(file => file.drawing) : [];
  if (assembly) pdfPaths.push(assemblyDrawingPath);
  const count = 2 + (models ? chosen.length : 0) + (printModels ? chosen.length : 0) + pdfPaths.length;
  const validPackage = Boolean(name.trim().replace(/\.zip$/i, "")) && (assembly || chosen.length > 0 && (models || printModels || partSheets));
  const canDownload = !busy && (single ? native || ready && !invalidScope && !!parts.length : ready && validPackage);
  const drawingTarget = singlePart ?? (parts.length === 1 ? parts[0] : undefined);

  function changePreset(next: ExportPreset) {
    if (busy || next === preset) return;
    setStatus(idle); setPreset(next);
    if (next === "drawings") setFiles(current => ({ ...current, drawings: true }));
  }
  function toggleFile(key: keyof typeof files) {
    setStatus(idle);
    setFiles(old => ({ ...old, [key]: !old[key] }));
  }
  function changePart(id: string) {
    setStatus(idle);
    setExcluded(old => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectParts(group: "all" | "machined" | "none") {
    setStatus(idle);
    setExcluded(new Set(parts.filter(p => group === "none" || group === "machined" && p.purchased).map(p => p.bodyId)));
  }
  function close() {
    running.current?.abort();
    onClose();
  }
  async function download() {
    if (!canDownload || running.current) return;
    const controller = new AbortController();
    running.current = controller;
    const progress = (message: string) => {
      if (!controller.signal.aborted) setStatus({ kind: "working", message });
    };
    progress(single ? "Preparing file…" : "Preparing package…");
    try {
      if (single) await onSingle(singleFormat, exportScope);
      else await onExport({ name: stem, parts: chosen, models, printModels, drawings: partSheets, assemblyDrawing: assembly }, progress, controller.signal);
      if (!controller.signal.aborted) setStatus({ kind: "complete", message: "Download started" });
    } catch (error) {
      if (!controller.signal.aborted) setStatus({ kind: "error", message: error instanceof Error ? error.message : "The export could not be completed." });
    } finally {
      if (running.current === controller) running.current = null;
    }
  }
  const reason = !single && !name.trim().replace(/\.zip$/i, "") ? "Enter a package name."
    : !native && !ready ? (parts.length ? "Waiting for the model to rebuild…" : "Build a solid to export geometry.")
    : !single && !chosen.length && !assembly ? (parts.length > 1 ? "Choose a component or include the assembly drawing." : "Choose a component to export.")
    : !single && !validPackage ? "Choose at least one output format."
    : invalidScope ? "Choose a body to export." : "";
  const format = fileFormats.find(item => item.id === singleFormat)!;
  const controls = [
    { key: "models", name: "STEP models", detail: "Exact solids for CNC", show: preset === "package" },
    { key: "printModels", name: "3MF print models", detail: "Unit-aware meshes", show: preset === "package" },
    { key: "drawings", name: "Part drawings", detail: "One PDF per component", show: true },
    { key: "assemblyDrawing", name: "Assembly drawing", detail: "Whole assembly in one PDF", show: parts.length > 1 },
  ] as const;

  return <Modal className="delivery-dialog" title="Export" onClose={close}>
    <div className="delivery-layout">
      <nav className="delivery-presets" aria-label="Export presets">
        <h3>Export preset</h3>
        {presets.map(({ id, name: label, hint, Icon }) =>
          <button className="delivery-preset" key={id} disabled={busy} aria-pressed={id === preset} aria-label={label}
            onClick={() => changePreset(id)}>
            <Icon size={19}/><span><strong>{label}</strong><small>{hint}</small></span>
          </button>)}
      </nav>
      <section className="delivery-settings" aria-label="Export settings">
        {single ? <>
          <h3>File settings</h3>
          <label className="delivery-field">File format
            <select aria-label="File format" disabled={busy} value={singleFormat} onChange={e => { setSingleFormat(e.target.value as SingleExportFormat); setStatus(idle); }}>
              {fileFormats.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <p className="delivery-description">{format.detail}</p>
          {!native && <label className="delivery-field">Export geometry
            <select aria-label="Export geometry" disabled={busy} value={exportScope} onChange={e => { onScopeChange(e.target.value); setStatus(idle); }}>
              <option value="all">{assemblyView ? "Assembly at current pose" : "All bodies"}</option>
              <option value="selected" disabled={!selectedBodyId}>Selected body (local coordinates)</option>
              <optgroup label="Individual parts in local coordinates">
                {parts.map(p => <option key={p.bodyId} value={"part:" + p.bodyId}>{p.name}{parts.some(other => other !== p && p.name === other.name) && " · " + p.item}</option>)}
              </optgroup>
            </select>
          </label>}
          {!native && drawingTarget && onOpenDrawing && <button className="delivery-drawing-link" disabled={busy || !ready}
            onClick={() => onOpenDrawing(drawingTarget.bodyId)}><SquarePen size={15}/>Open part drawing</button>}
        </> : <>
          <h3>Package settings</h3>
          <label className="delivery-field">Package name
            <span className="delivery-name"><input aria-label="Package name" value={name} disabled={busy} onChange={e => { setCustomName(e.target.value); setStatus(idle); }}/><span>.zip</span></span>
          </label>
          <fieldset className="delivery-formats" disabled={busy}>
            <legend>Include in package</legend>
            <div>{controls.filter(option => option.show).map(option =>
              <label key={option.key} className={files[option.key] ? "is-on" : ""}>
                <input type="checkbox" checked={files[option.key]} onChange={() => toggleFile(option.key)} aria-label={option.name}/>
                <span><strong>{option.name}</strong><small>{option.detail}</small></span>
              </label>)}</div>
          </fieldset>
          <section className="delivery-parts" aria-label="Components to export">
            <div className="delivery-parts-heading"><h3>Components</h3><span>{chosen.length} of {parts.length} selected</span></div>
            <div className="delivery-selection">
              <button disabled={busy || chosen.length === parts.length} onClick={() => selectParts("all")}><CheckCheck size={13}/>All parts</button>
              <button disabled={busy || !parts.length} onClick={() => selectParts("machined")}>Machined only</button>
              <button disabled={busy || !chosen.length} onClick={() => selectParts("none")}>Clear selection</button>
            </div>
            <div className="delivery-part-list">
              {parts.length ? parts.map(p => <label className="delivery-part" key={p.bodyId}>
                <input type="checkbox" disabled={busy} aria-label={p.name + " · item " + p.item} checked={!excluded.has(p.bodyId)} onChange={() => changePart(p.bodyId)}/>
                <span className="delivery-item">{String(p.item).padStart(2, "0")}</span>
                <span><strong>{p.name}</strong><small>{p.material}{p.appearance && " · " + p.appearance}</small></span>
                {p.purchased && <span className="delivery-source">Purchased</span>}
              </label>) : <p className="delivery-description">No modeled components.</p>}
            </div>
          </section>
        </>}
      </section>
      <aside className="delivery-preview" aria-label="Export preview">
        <div className="delivery-preview-heading"><ListTree size={16}/><h3>{single ? "Output file" : "Archive contents"}</h3></div>
        <div className="delivery-output-name">{single ? <FileBox size={22}/> : <FileArchive size={22}/>}
          <div><strong>{outputName}</strong><small>{single ? format.label : count + " files"}</small></div>
        </div>
        {!single && <div className="delivery-tree">
          {models && <FileGroup label="Parts" paths={paths.map(p => p.model)}/>}
          {printModels && <FileGroup label="Print" paths={paths.map(p => p.print)}/>}
          <FileGroup label="Drawings" paths={pdfPaths}/>
          <div className="delivery-root-file"><Sheet size={14}/>Parts list.csv</div>
          <div className="delivery-root-file"><FileText size={14}/>Shop manifest.txt</div>
        </div>}
        {single && <dl className="delivery-single-details">
          <div><dt>Source</dt><dd>{native ? "Full project" : singlePart?.name ?? (assemblyView ? "Assembly" : "All bodies")}</dd></div>
          {!native && <div><dt>Coordinates</dt><dd>{singlePart ? "Part local" : assemblyView ? "Current pose" : "Model space"}</dd></div>}
          {(native || singleFormat === "3mf" || singleFormat === "step") && <div><dt>Units</dt><dd>Millimetres</dd></div>}
        </dl>}
      </aside>
    </div>
    <footer className="delivery-footer">
      <div className={"delivery-status " + status.kind} role={status.kind === "error" ? "alert" : "status"}>
        {busy ? <LoaderCircle className="spin" size={16}/> : status.kind === "complete" ? <Check size={16}/>
          : status.kind === "error" ? <CircleAlert size={16}/> : single ? <FileBox size={16}/> : <Files size={16}/>}
        <span>{status.message || reason || (single ? "1 file" : chosen.length + (chosen.length === 1 ? " component" : " components") + " · " + count + " files")}</span>
      </div>
      <button className="delivery-close" onClick={close}>{busy && !single ? "Cancel export" : "Close"}</button>
      <button className="primary delivery-download" disabled={!canDownload} onClick={() => void download()}>
        {busy ? <LoaderCircle size={16} className="spin"/> : <ArrowDownToLine size={16}/>}
        {busy ? "Exporting…" : single ? native ? "Download project" : "Download " + singleFormat.toUpperCase() : "Download ZIP"}
      </button>
    </footer>
  </Modal>;
}
