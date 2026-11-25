import { useEffect, useRef, useState } from "react";
import { FileUp, FileBox } from "lucide-react";
import { Modal } from "./Dialogs";
import { uid } from "./projects";
import { importPlanar } from "./exchangePlanar";
import {
  fileFormat,
  type FileUnit,
  type ImportedFile,
  type ImportFormat,
  type StoredBody,
} from "./exchangeTypes";
import type { SolidImportReply } from "./exchangeWorker";
import type { Feature, Project } from "./types";
import "./exchange.css";

function asBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result);
      resolve(raw.slice(raw.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(
        new Error("The selected file could not be read. Choose it again."),
      );
    reader.readAsDataURL(file);
  });
}

type Props = {
  project: Project;
  onSave: (updated: Project) => void;
  onClose: () => void;
};

export default function ExchangeDialog({ project, onSave, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null),
    [format, setFormat] = useState<ImportFormat | null>(null);
  const [unit, setUnit] = useState<FileUnit>("mm"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    worker = useRef<Worker | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      worker.current?.terminate();
    };
  }, []);
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
  async function accept() {
    if (!file || !format || busy) return;
    setBusy(true);
    setError("");
    try {
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
      if (alive.current) setBusy(false);
    }
  }
  const details: Record<ImportFormat, string> = {
    step: "Import closed STEP solids as body features with their surfaces and edges.",
    stl: "Import watertight STL meshes as faceted solids. Each triangle becomes a face.",
    dxf: "Import supported closed 2D contours as editable sketches. Extrude or revolve a sketch to make a body.",
    svg: "Import supported closed vector outlines as editable sketches. Page units and the SVG viewBox determine their size.",
  };
  return (
    <Modal title="Import geometry" onClose={onClose}>
      <input
        type="file"
        ref={fileInput}
        hidden
        accept=".stp,.step,.stl,.dxf,.svg"
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
              : "STEP, STL, DXF, or SVG"}
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
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!file || busy} onClick={accept}>
          Import{" "}
          {format === "svg" || format === "dxf"
            ? "sketches"
            : format
              ? "bodies"
              : "geometry"}
        </button>
      </div>
    </Modal>
  );
}
