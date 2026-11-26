import { useEffect, useRef, useState } from "react";
import { FileUp, FileBox } from "lucide-react";
import { Modal } from "./Dialogs";
import { readProjectFile, uid } from "./projects";
import { insertNativeParts } from "./nativePartImport";
import { importPlanar } from "./exchangePlanar";
import {
  asBase64,
  fileFormat,
  type FileUnit,
  type ImportedFile,
  type ImportFormat,
  type StoredBody,
} from "./exchangeTypes";
import type { SolidImportReply } from "./exchangeWorker";
import type { Feature, Project } from "./types";
import "./exchange.css";

type Props = {
  project: Project;
  onSave: (updated: Project) => void;
  onOpenProject: (restored: Project) => void;
  onClose: () => void;
};

export default function ExchangeDialog({ project, onSave, onOpenProject, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null),
    [format, setFormat] = useState<ImportFormat | null>(null);
  const [unit, setUnit] = useState<FileUnit>("mm"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    worker = useRef<Worker | null>(null),
    nativeImport = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      nativeImport.current?.abort();
      worker.current?.terminate();
    };
  }, []);
  function dismiss() {
    alive.current = false;
    nativeImport.current?.abort();
    worker.current?.terminate();
    onClose();
  }
  const choose = (next: File | undefined) => {
    if (!next || busy) return;
    setError("");
    try {
      if (!next.size) throw new Error("The selected file is empty.");
      const kind = fileFormat(next.name);
      setFile(next);
      setFormat(kind);
    } catch (e) {
      setFile(null);
      setFormat(null);
      setError((e as Error).message);
    }
  };
  function readSolid(selected: File, kind: "step" | "stl") {
    return new Promise<StoredBody[]>((resolve, reject) => {
      const w = new Worker(new URL("./exchangeWorker.ts", import.meta.url), {
        type: "module",
        name: "turnmill-file-import",
      });
      worker.current = w;
      w.onmessage = ({ data }: MessageEvent<SolidImportReply>) => {
        "error" in data ? reject(new Error(data.error)) : resolve(data.bodies);
      };
      w.onerror = (e) =>
        reject(
          new Error(
            "The import worker could not read the solid. " + (e.message || ""),
          ),
        );
      w.postMessage({ file: selected, format: kind, unit });
    });
  }
  async function accept(action: "open" | "insert") {
    if (!file || !format || busy) return;
    setBusy(true);
    setError("");
    try {
      if (format === "turnmill") {
        const source = await readProjectFile(file);
        if (!alive.current) return;
        if (action === "open") {
          onOpenProject(source);
        } else {
          const controller = new AbortController();
          nativeImport.current = controller;
          const next = await insertNativeParts(project, source, file, controller.signal);
          if (alive.current && !controller.signal.aborted) onSave(next);
        }
        return;
      }
      const source: ImportedFile = {
        id: uid(),
        name: file.name,
        format,
        data: await asBase64(file),
      };
      if (!alive.current) return;
      const files = () => [...(project.importedFiles || []), source];
      if (format === "step" || format === "stl") {
        if (format === "stl") source.unit = unit;
        source.bodies = await readSolid(file, format);
        const features: Feature[] = source.bodies.map((body, i) => ({
          id: uid(),
          name: body.name,
          kind: "import",
          sourceId: source.id,
          sourceIndex: i,
          operation: "new",
          sketchId: "",
          amount: "0",
          suppressed: false,
        }));
        if (alive.current)
          onSave({
            ...project,
            importedFiles: files(),
            features: [...project.features, ...features],
          });
      } else {
        if (format === "dxf") source.unit = unit;
        const sketches = importPlanar(
          await file.text(),
          format,
          file.name.replace(/\.(dxf|svg)$/i, ""),
          unit,
        );
        if (!sketches.length)
          throw new Error("The file has no supported closed profile.");
        source.sketchIds = sketches.map((s) => s.id);
        if (alive.current)
          onSave({
            ...project,
            importedFiles: files(),
            sketches: [...project.sketches, ...sketches],
          });
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "The file could not be imported.",
        );
    } finally {
      worker.current?.terminate();
      worker.current = null;
      nativeImport.current = null;
      if (alive.current) setBusy(false);
    }
  }
  const details: Record<ImportFormat, string> = {
    turnmill: "Open project keeps the sketches, threads and refill setup editable. Insert parts adds solid copies to your current design.",
    step: "Import closed STEP solids as body features with their surfaces and edges.",
    stl: "Import watertight STL meshes as faceted solids. Each triangle becomes a face.",
    dxf: "Import supported closed 2D contours as editable sketches. Extrude or revolve a sketch to make a body.",
    svg: "Import supported closed vector outlines as editable sketches. Page units and the SVG viewBox determine their size.",
  };
  return (
    <Modal title="Import geometry" onClose={dismiss}>
      <input
        type="file"
        ref={fileInput}
        hidden
        accept=".turnmill,.turnmil,.stp,.step,.stl,.dxf,.svg"
        aria-label="Choose file to import"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        className={"exchange-file " + (over ? "drag-over" : "")}
        type="button"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          choose(e.dataTransfer.files[0]);
        }}
      >
        {file ? <FileBox size={24} /> : <FileUp size={24} />}
        <span>
          <strong>{file ? file.name : "Choose a file or drop it here"}</strong>
          <small>
            {file
              ? Intl.NumberFormat(undefined, {
                  maximumFractionDigits: 1,
                }).format(file.size / 1024) + " KB · Change file"
              : "Turnmill (.turnmill or .turnmil), STEP, STL, DXF, or SVG"}
          </small>
        </span>
      </button>
      {format && <p className="helper">{details[format]}</p>}
      {(format === "dxf" || format === "stl") && (
        <label className="exchange-unit">
          {format === "stl"
            ? "STL coordinate units"
            : "Units for DXF files without unit metadata"}
          <select
            disabled={busy}
            value={unit}
            onChange={(e) => setUnit(e.target.value as FileUnit)}
          >
            <option value="mm">Millimeters</option>
            <option value="in">Inches</option>
          </select>
        </label>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="helper">
          Reading {file?.name}…
        </p>
      )}
      <div className="dialog-actions">
        <button onClick={dismiss}>Cancel</button>
        {format === "turnmill" && <button disabled={busy} onClick={() => void accept("open")}>Open project</button>}
        <button className="primary" disabled={!file || busy} onClick={() => void accept("insert")}>
          {format === "turnmill" ? "Insert parts" : format === "svg" || format === "dxf"
            ? "Import sketches" : format ? "Import bodies" : "Import geometry"}
        </button>
      </div>
    </Modal>
  );
}
