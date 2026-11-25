import { recordGuideDrawing } from "./penGuide";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDrawingProjection } from "./useDrawingProjection";
import { Download, FileText, Printer, Plus, X } from "lucide-react";
import type { JointConfig } from "./kinematics";
import { assemblySheets } from "./secondaryAssemblySheet";
import { evaluate } from "./expressions";
import {
  changeWorkspace,
  dxfFile,
  fileName,
  n,
  NumberField,
  printSheets,
  saveAs,
  SheetView,
  svgFile,
  TextField,
  type WorkspaceProps,
} from "./secondaryVector";
import {
  makeDrawing,
  type DrawingData,
  type Measure,
} from "./secondaryDrawing";
import {
  manufacturingSheets,
  surfaceKey,
  type TechSheet,
  type SheetOptions,
} from "./secondaryManufacturing";
import type { SectionAxis } from "./secondaryProjection";
import SectionPlane from "./SectionPlane";
import DownloadDrawingPdf from "./DownloadDrawingPdf";
import ExplosionControls from "./ExplosionControls";
import { assemblyParts } from "./AssemblyBom";
import FinishedDimensionDialog, {
  type ViewSnaps,
} from "./FinishedDimensionDialog";
import { Modal } from "./Dialogs";
import {
  drawingSources,
  partSheetKey,
  type DrawingSheetSettings,
} from "./drawingSheetSettings";
import {
  dimensionSnaps,
  sectionSnaps,
  type DimensionGeometry,
  formatDrawingLength,
  formatTolerance,
  dimensionSheetName,
  measureDimension,
  orthographic,
  viewName,
  type FinishedDimension,
} from "./drawingDimensions";

const noDimensions: FinishedDimension[] = [];
const emptySnaps: ViewSnaps = { front: [], top: [], right: [], section: [] };
const noJoints: JointConfig = {};
export default function Drawing(
  props: WorkspaceProps & { rebuilding?: boolean },
) {
  const cfg = props.project.workspaces?.drawing || {},
    scope = cfg.scope || "finished";
  const [aa, A] = useState(0),
    [bb, B] = useState(1),
    [msg, message] = useState(""),
    [page, setPage] = useState(0);
  const features = props.features.filter((f) => f.operation === "new");
  const chosen = cfg.feature
    ? features.find((f) => f.id === cfg.feature)
    : features[0];
  const start = props.features.findIndex((f) => f.id === chosen?.id);
  const following = props.features
    .slice(start + 1)
    .findIndex((f) => f.operation === "new");
  const body = useMemo(
    () =>
      start >= 0
        ? props.features.slice(
            start,
            following >= 0 ? start + 1 + following : undefined,
          )
        : [],
    [props.features, start, following],
  );
  const assembly = scope === "assembly";
  const annotations =
    (assembly
      ? cfg.assemblyAnnotations
      : cfg.annotations?.[chosen?.id || ""]) || {};
  const hasSection =
    scope === "finished" || (assembly && !!annotations.sectionEnabled);
  const source = assembly ? props.features : body;
  const savedDims: FinishedDimension[] =
    annotations.finishedDimensions || noDimensions;
  const [editingDimension, editDimension] = useState<string | null>(null);
  const [wantedPage, wantPage] = useState("");
  const exactDrawing =
    scope !== "profile" &&
    (!!editingDimension || savedDims.length > 0) &&
    source.some((f) =>
      f.finishes?.some(
        (op) => !op.suppressed && op.kind === "thread" && op.mode === "modeled",
      ),
    );
  const modeled = cfg.modeled === true || exactDrawing;
  const sectionAxis: SectionAxis = hasSection
    ? annotations.sectionAxis || "Y"
    : "Y";
  const sectionOffset: string = hasSection
    ? annotations.sectionOffset || "0 mm"
    : "0 mm";
  const joints: JointConfig = props.project.workspaces?.joints || noJoints;
  const drawingJoints = assembly ? joints : undefined;
  const drawingSource = useMemo(
    () =>
      !props.rebuilding && scope !== "profile" && source.length
        ? {
            features: source,
            joints: drawingJoints,
            values: props.values,
            parameters: props.project.parameters,
            modeled,
          }
        : null,
    [props.rebuilding, scope, source, drawingJoints, props.values, props.project.parameters, modeled],
  );
  const projected = useDrawingProjection(
    drawingSource,
    hasSection,
    sectionAxis,
    sectionOffset,
  );
  const blocks = drawingSources(cfg, features[0]?.id);
  const blockKey =
    scope === "assembly" ? "assembly" : partSheetKey(chosen?.id || "");
  const block = blocks[blockKey] || {};
  const patch = (v: Record<string, unknown>) =>
    changeWorkspace(props, "drawing", {
      ...(!cfg.sources ? { sources: blocks } : {}),
      ...v,
    });
  const setBlock = (fields: DrawingSheetSettings) =>
    patch({ sources: { ...blocks, [blockKey]: { ...block, ...fields } } });
  const result = projected?.result,
    home = projected?.assembly;
  const dimensionViews = useMemo<DimensionGeometry | undefined>(
    () =>
      result?.views ||
      (home ? { ...home.views, section: home.section?.view } : undefined),
    [result, home],
  );
  const cutBounds = dimensionViews?.section?.bounds;
  const defaultDetailWidth =
    cutBounds && cutBounds[1][0] > cutBounds[0][0]
      ? formatDrawingLength((cutBounds[1][0] - cutBounds[0][0]) / 4) + " mm"
      : "8 mm";
  const snapNeeded = !!editingDimension || savedDims.length > 0;
  const snaps = useMemo<ViewSnaps>(() => {
    if (!dimensionViews || !snapNeeded) return emptySnaps;
    const entries = orthographic.map(
      (view) =>
        [
          view,
          dimensionSnaps(
            view,
            dimensionViews[view],
            body,
            props.project,
            !assembly,
          ),
        ] as const,
    );
    return {
      ...Object.fromEntries(entries),
      section: dimensionViews.section
        ? sectionSnaps(
            dimensionViews.section,
            sectionAxis,
            result?.sectionOffset ?? home?.section?.offset ?? 0,
            props.project,
            assembly,
          )
        : [],
    } as ViewSnaps;
  }, [
    dimensionViews,
    snapNeeded,
    body,
    props.project.features,
    props.project.sketches,
    assembly,
    sectionAxis,
    result?.sectionOffset,
    home?.section?.offset,
  ]);
  const setAnnotation = (fields: Record<string, unknown>) => {
    if (assembly) patch({ assemblyAnnotations: { ...annotations, ...fields } });
    else if (chosen)
      patch({
        annotations: {
          ...cfg.annotations,
          [chosen.id]: { ...annotations, ...fields },
        },
      });
  };
  const stations = projected?.result?.stations || [];
  const defaultStation = stations
    .slice()
    .sort((a, b) => b.xMax - b.xMin - (a.xMax - a.xMin))[0];
  const primaryKey = defaultStation ? surfaceKey(defaultStation) : "";
  const surfaceSelect = (title: string, key: "formKey" | "datumKey") => (
    <label className="tm-field">
      <span>{title}</span>
      <select
        aria-label={title}
        value={annotations[key] || ""}
        onChange={(e) => setAnnotation({ [key]: e.target.value })}
      >
        {!stations.some((s) => surfaceKey(s) === annotations[key]) && (
          <option value={annotations[key] || ""}>
            {annotations[key]
              ? "Missing referenced surface"
              : "Choose a cylindrical face"}
          </option>
        )}
        {stations.map((s) => (
          <option key={surfaceKey(s)} value={surfaceKey(s)}>
            {s.side === "internal"
              ? "Bore"
              : s.side === "external"
                ? "Outside"
                : "Cylinder"}{" "}
            Ø {n(s.diameter)} · X {n(s.xMin)}–{n(s.xMax)}
          </option>
        ))}
      </select>
    </label>
  );
  const modelFeature = props.project.features.find((f) => f.id === chosen?.id);
  const sketch = props.project.sketches.find(
    (s) => s.id === modelFeature?.sketchId,
  );
  const keys = sketch?.points.map((p) => JSON.stringify([p.x, p.y])) || [];
  const measures: Measure[] = cfg.measures?.[chosen?.id || ""] || [];
  const stale = measures.some(
    (m) => keys[m.a] !== m.keyA || keys[m.b] !== m.keyB,
  );
  const setMeasures = (items: Measure[]) => {
    if (chosen) patch({ measures: { ...cfg.measures, [chosen.id]: items } });
  };
  const title =
    block.title ??
    (scope === "assembly"
      ? props.project.name
      : features.length > 1
        ? chosen?.name
        : props.project.name) ??
    props.project.name;
  const scaleChoice = block.scale;
  const bom = useMemo(
    () => assemblyParts(props.project, props.features),
    [props.project, props.features],
  );
  const partRow = bom.find((row) => row.bodyId === chosen?.id);
  const data: DrawingData = {
    title,
    number:
      block.number ??
      (scope === "assembly"
        ? "TM-A01"
        : "TM-" + String(partRow?.item || 1).padStart(3, "0")),
    revision: block.revision ?? "A",
    material:
      block.material ?? (scope !== "assembly" ? (partRow?.material ?? "") : ""),
    note: block.note ?? "",
    dimensions: cfg.dimensions !== false,
    hatch: cfg.hatch !== false,
    scale: scaleChoice && scaleChoice !== "auto" ? Number(scaleChoice) : "auto",
    measures,
  };
  const { sheets, scale, err } = useMemo(() => {
    let sheets: TechSheet[] = [],
      scale = 1,
      err = "";
    try {
      if (props.rebuilding) throw Error("Rebuilding the source geometry…");
      if (!chosen && scope !== "assembly")
        throw Error(
          cfg.feature
            ? "The linked body was removed or suppressed. Choose an available source."
            : "Create or import a solid body to generate a linked drawing.",
        );
      if (assembly && !features.length)
        throw Error(
          "Create or import at least one solid body to draw an assembly.",
        );
      if (scope !== "profile" && !projected?.result && !projected?.assembly) {
        throw Error(
          projected?.error ||
            (assembly
              ? "Projecting the assembled components…"
              : "Projecting the finished solid…"),
        );
      }
      const tol =
        scope !== "profile" && block.tolerance
          ? evaluate(block.tolerance, props.values)
          : 0;
      if (tol < 0)
        throw Error("Use a nonnegative general tolerance, or clear the field.");
      const options: SheetOptions = {
        manualDimensions: (scope === "profile" ? noDimensions : savedDims).map(
          (d, i) => {
            try {
              if (d.view === "section" && !dimensionViews?.section)
                throw Error(
                  "Enable the assembly section or edit this dimension and choose another view.",
                );
              return measureDimension(d, snaps[d.view] || [], props.values);
            } catch (e) {
              throw Error(
                "Dimension " +
                  (i + 1) +
                  " · " +
                  viewName(d.view) +
                  ". " +
                  (e as Error).message,
              );
            }
          },
        ),
      };
      if (hasSection && block.detail)
        options.detail = {
          end: block.detailEnd === "start" ? "start" : "end",
          width: evaluate(
            String(block.detailWidth ?? defaultDetailWidth),
            props.values,
          ),
        };
      if (scope === "assembly") {
        if (projected?.error) throw Error(projected.error);
        if (!projected?.assembly)
          throw Error("Projecting the assembled components…");
        sheets = assemblySheets(projected.assembly, data, bom, {
          manualDimensions: options.manualDimensions,
          tolerance: tol > 0 ? formatTolerance(tol) : "",
          detail: options.detail,
          section: projected.assembly.section,
          axis: cfg.explodeAxis || "joints",
          gap: cfg.explodeGap
            ? evaluate(cfg.explodeGap, props.values)
            : undefined,
        });
      } else if (scope === "finished") {
        if (projected?.error) throw Error(projected.error);
        if (!projected?.result) throw Error("Projecting the finished solid…");
        if (annotations.form)
          options.form = {
            kind:
              annotations.formKind === "straightness"
                ? "straightness"
                : "roundness",
            key: annotations.formKey || "",
            value: evaluate(
              String(annotations.formValue ?? "0.01 mm"),
              props.values,
            ),
          };
        if (annotations.datum)
          options.datum = {
            key: annotations.datumKey || "",
            letter: annotations.letter || "A",
          };
        ({ sheets, scale } = manufacturingSheets(
          projected.result,
          data,
          body,
          tol > 0 ? formatTolerance(tol) : "",
          options,
        ));
      } else {
        if (!chosen) throw Error("Select a source body.");
        if (chosen.kind === "import")
          throw Error(
            "This imported body has no editable base profile. Select Finished body to draw it.",
          );
        if (stale)
          throw Error(
            "A dimension references an edited or missing sketch point. Remove that dimension and select its endpoints again.",
          );
        const result = makeDrawing(chosen, data);
        scale = result.scale;
        sheets = [{ label: "Base feature", sheet: result.sheet }];
      }
    } catch (e) {
      err = (e as Error).message;
    }
    return { sheets, scale, err };
  }, [
    props.project,
    props.features,
    props.values,
    props.rebuilding,
    scope,
    body,
    chosen,
    projected,
    snaps,
    savedDims,
    hasSection,
    defaultDetailWidth,
    stale,
    bom,
    title,
  ]);
  const currentDocument = useRef<typeof props.project | null>(props.project);
  currentDocument.current = props.project;
  useEffect(
    () => () => {
      currentDocument.current = null;
    },
    [],
  );
  function afterDocumentOutput() {
    if (currentDocument.current !== props.project) return;
    const next = recordGuideDrawing(
      props.project,
      scope,
      chosen?.id,
      cfg.dimensions !== false,
    );
    if (next !== props.project) props.onChange(next);
  }
  const current = sheets[Math.min(page, Math.max(0, sheets.length - 1))];
  const sheetScale = current?.scale ?? scale;
  const wantedIndex = sheets.findIndex((s) => s.label === wantedPage);
  useEffect(() => {
    if (wantedPage && wantedIndex >= 0) {
      setPage(wantedIndex);
      wantPage("");
    }
  }, [wantedPage, wantedIndex]);
  const base = fileName(title);
  const later =
    body.length > 1 ||
    !!chosen?.advanced ||
    !!chosen?.operations?.length ||
    !!chosen?.finishes?.some((f) => !f.suppressed) ||
    !!chosen?.ruler;
  return (
    <div className="tm-workspace">
      <main className="tm-work-main">
        <header className="tm-work-head">
          <div>
            <h2>Drawing</h2>
            <p>
              {scope === "assembly"
                ? props.project.name
                : chosen?.name || "No source selected"}{" "}
              · A4 landscape
            </p>
          </div>
          <button
            className="tm-btn accent"
            disabled={!current}
            onClick={() => {
              if (
                !printSheets(
                  sheets.map((s) => s.sheet),
                  title,
                )
              )
                message("Allow the print window and choose Save as PDF.");
              else afterDocumentOutput();
            }}
          >
            <Printer size={15} />
            Print / PDF
          </button>
        </header>
        {scope === "profile" && later && (
          <div className="tm-inline-error">
            This sheet shows the selected base feature before later operations.
            Select Finished body to include them.
          </div>
        )}
        {sheets.length > 1 && (
          <div className="tm-page-pick" aria-label="Drawing sheets">
            {sheets.map((s, i) => (
              <button
                key={i}
                aria-pressed={s === current}
                onClick={() => setPage(i)}
              >
                {i + 1} · {s.label}
              </button>
            ))}
          </div>
        )}
        <div className="tm-paper-stage">
          {current ? (
            <SheetView name="Linked part drawing" sheet={current.sheet} />
          ) : (
            <div className="tm-empty">
              <FileText size={30} />
              <p>{err}</p>
            </div>
          )}
        </div>
        <div className="tm-sheet-bar">
          <span className="tm-dot" />{" "}
          {current
            ? "Linked to " +
              (scope === "assembly" ? props.project.name : chosen?.name)
            : "Waiting for drawing"}{" "}
          <span className="tm-spacer" />
          {current && scope !== "assembly" && (
            <span>
              Scale{" "}
              {sheetScale >= 1
                ? n(sheetScale) + ":1"
                : "1:" + n(1 / sheetScale)}{" "}
              · mm
            </span>
          )}
        </div>
        {msg && <p className="tm-inline-error">{msg}</p>}
        <div className="tm-export-line">
          <button
            className="tm-btn"
            disabled={!current}
            onClick={() =>
              current &&
              saveAs(
                svgFile(current.sheet),
                "image/svg+xml",
                base + "-" + fileName(current.label) + ".svg",
              )
            }
          >
            <Download size={14} />
            Drawing SVG
          </button>
          <button
            className="tm-btn"
            disabled={!current}
            onClick={() =>
              current &&
              saveAs(
                dxfFile(current.sheet),
                "application/dxf",
                base + "-" + fileName(current.label) + ".dxf",
              )
            }
          >
            <Download size={14} />
            Sheet DXF
          </button>
          <DownloadDrawingPdf
            sheets={sheets}
            title={title}
            disabled={!current}
            onError={message}
            onDownloaded={afterDocumentOutput}
          />
        </div>
      </main>
      <aside className="tm-inspector">
        <h3>Sheet settings</h3>
        <label className="tm-field">
          <span>Source body</span>
          <select
            disabled={scope === "assembly"}
            aria-label="Source body"
            value={chosen?.id || ""}
            onChange={(e) => {
              setPage(0);
              wantPage("");
              patch({ feature: e.target.value });
            }}
          >
            {!chosen && <option value="">Select a body</option>}
            {features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="tm-field">
          <span>Drawing source</span>
          <select
            aria-label="Drawing source"
            value={scope}
            onChange={(e) => {
              setPage(0);
              wantPage("");
              patch({ scope: e.target.value });
            }}
          >
            <option value="finished">Finished body</option>
            <option value="assembly">Assembly · exploded / BOM</option>
            <option value="profile">Base feature profile</option>
          </select>
        </label>
        <label className="tm-field">
          <span>Drawing scale</span>
          <select
            aria-label="Drawing scale"
            value={scaleChoice || "auto"}
            onChange={(e) => setBlock({ scale: e.target.value })}
          >
            <option value="auto">Fit to sheet</option>
            {[4, 2, 1, 0.5, 0.25, 0.1, 0.05].map((s) => (
              <option key={s} value={s}>
                {s >= 1 ? s + ":1" : "1:" + 1 / s}
              </option>
            ))}
          </select>
        </label>
        <label className="tm-check">
          <input
            type="checkbox"
            checked={cfg.dimensions !== false}
            onChange={(e) => patch({ dimensions: e.target.checked })}
          />
          Overall dimensions
        </label>
        {(hasSection ||
          (scope === "profile" && chosen?.kind === "revolve")) && (
          <label className="tm-check">
            <input
              type="checkbox"
              checked={cfg.hatch !== false}
              onChange={(e) => patch({ hatch: e.target.checked })}
            />
            Section hatching
          </label>
        )}
        {scope !== "profile" &&
          source.some((f) =>
            f.finishes?.some(
              (g) =>
                g.kind === "thread" && g.mode === "modeled" && !g.suppressed,
            ),
          ) && (
            <label className="tm-check">
              <input
                type="checkbox"
                disabled={exactDrawing}
                checked={modeled}
                onChange={(e) => patch({ modeled: e.target.checked })}
              />
              Show modeled flanks in exterior views
              {exactDrawing ? " (used by linked dimensions)" : ""}
            </label>
          )}
        {scope !== "profile" && (
          <NumberField
            title="General linear tolerance (±)"
            expr={block.tolerance || "0"}
            values={props.values}
            valid={(v) => v >= 0}
            onCommit={(tolerance) => setBlock({ tolerance })}
            unit="mm"
          />
        )}
        {scope === "assembly" && (
          <ExplosionControls
            axis={cfg.explodeAxis || "joints"}
            gap={cfg.explodeGap || ""}
            values={props.values}
            onChange={patch}
          />
        )}
        {scope !== "profile" && (assembly || chosen) && (
          <>
            {assembly && (
              <label className="tm-check">
                <input
                  type="checkbox"
                  checked={hasSection}
                  onChange={(e) =>
                    setAnnotation({ sectionEnabled: e.target.checked })
                  }
                />
                Include assembly section
              </label>
            )}
            {hasSection && (
              <SectionPlane
                axis={sectionAxis}
                offset={sectionOffset}
                values={props.values}
                onChange={setAnnotation}
              />
            )}
            <button
              className="tm-btn"
              disabled={!dimensionViews}
              onClick={() => editDimension("new")}
            >
              <Plus size={14} />
              Add dimension
            </button>
            {savedDims.map((dim, i) => {
              let summary = "Pick replacement points";
              try {
                summary =
                  measureDimension(dim, snaps[dim.view] || [], props.values)
                    .text + " mm";
              } catch {
                /* The editor supports repairing missing points and expressions. */
              }
              return (
                <div key={dim.id} className="tm-dim-row">
                  <button
                    className="tm-dim-edit"
                    disabled={!dimensionViews}
                    aria-label={"Edit dimension " + (i + 1)}
                    onClick={() => editDimension(dim.id)}
                  >
                    {i + 1} · {viewName(dim.view)} · {summary}
                  </button>
                  <button
                    className="tm-icon"
                    aria-label={"Remove dimension " + (i + 1)}
                    onClick={() =>
                      setAnnotation({
                        finishedDimensions: savedDims.filter(
                          (d) => d.id !== dim.id,
                        ),
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </>
        )}
        {hasSection && (
          <details className="tm-more">
            <summary>
              {assembly ? "Section detail" : "Annotations and detail views"}
            </summary>
            <label className="tm-check">
              <input
                type="checkbox"
                checked={!!block.detail}
                onChange={(e) => setBlock({ detail: e.target.checked })}
              />
              Enlarged section detail
            </label>
            {block.detail && (
              <>
                <label className="tm-field">
                  <span>Detail end</span>
                  <select
                    value={block.detailEnd || "end"}
                    onChange={(e) => setBlock({ detailEnd: e.target.value })}
                  >
                    <option value="end">Far end</option>
                    <option value="start">Start end</option>
                  </select>
                </label>
                <NumberField
                  title="Detail width"
                  expr={String(block.detailWidth ?? defaultDetailWidth)}
                  values={props.values}
                  valid={(v) => v > 0}
                  unit="mm"
                  onCommit={(detailWidth) => setBlock({ detailWidth })}
                />
              </>
            )}
            {!assembly && (
              <>
                <label className="tm-check">
                  <input
                    type="checkbox"
                    checked={!!annotations.form}
                    disabled={!stations.length && !annotations.form}
                    onChange={(e) =>
                      setAnnotation({
                        form: e.target.checked,
                        formKey: annotations.formKey || primaryKey,
                      })
                    }
                  />
                  Geometric form control
                </label>
                {annotations.form && (
                  <>
                    {surfaceSelect("Controlled surface", "formKey")}
                    <label className="tm-field">
                      <span>Form characteristic</span>
                      <select
                        value={annotations.formKind || "roundness"}
                        onChange={(e) =>
                          setAnnotation({ formKind: e.target.value })
                        }
                      >
                        <option value="roundness">Circularity</option>
                        <option value="straightness">
                          Surface straightness
                        </option>
                      </select>
                    </label>
                    <NumberField
                      title="Form tolerance"
                      expr={String(annotations.formValue ?? "0.01 mm")}
                      values={props.values}
                      valid={(v) => v > 0}
                      unit="mm"
                      onCommit={(formValue) => setAnnotation({ formValue })}
                    />
                  </>
                )}
                <label className="tm-check">
                  <input
                    type="checkbox"
                    checked={!!annotations.datum}
                    disabled={!stations.length && !annotations.datum}
                    onChange={(e) =>
                      setAnnotation({
                        datum: e.target.checked,
                        datumKey: annotations.datumKey || primaryKey,
                      })
                    }
                  />
                  Datum feature
                </label>
                {annotations.datum && (
                  <>
                    {surfaceSelect("Datum surface", "datumKey")}
                    <TextField
                      title="Datum letter"
                      value={annotations.letter || "A"}
                      onCommit={(letter) =>
                        setAnnotation({ letter: letter.trim().toUpperCase() })
                      }
                    />
                  </>
                )}
                {(annotations.form || annotations.datum) && (
                  <p className="tm-help">
                    These annotations specify design requirements. If the
                    attached diameter or axial limits change, select the surface
                    again.
                  </p>
                )}
              </>
            )}
          </details>
        )}
        <h3>Title block</h3>
        <TextField
          title={scope === "assembly" ? "Assembly name" : "Part name"}
          value={title}
          onCommit={(title) => setBlock({ title })}
        />
        <div className="tm-pair">
          <TextField
            title="Drawing no."
            value={data.number}
            onCommit={(number) => setBlock({ number })}
          />
          <TextField
            title="Revision"
            value={data.revision}
            onCommit={(revision) => setBlock({ revision })}
          />
        </div>
        <TextField
          title="Material"
          value={data.material}
          onCommit={(material) => setBlock({ material })}
        />
        <TextField
          title="Shop note"
          value={data.note}
          onCommit={(note) => setBlock({ note })}
        />
        {scope === "profile" && chosen && (
          <details className="tm-more">
            <summary>Point-to-point dimensions</summary>
            <p className="tm-help">
              Select two profile corners. The sheet labels their straight-line
              separation.
            </p>
            <div className="tm-pair">
              {[
                ["From", aa, A],
                ["To", bb, B],
              ].map(([text, index, set]) => (
                <label className="tm-field" key={String(text)}>
                  <span>{String(text)}</span>
                  <select
                    value={Number(index)}
                    onChange={(e) => (set as typeof A)(+e.target.value)}
                  >
                    {chosen.points.map(([x, y], i) => (
                      <option key={i} value={i}>
                        P{i + 1} · {n(x)}, {n(y)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="tm-btn"
              disabled={
                aa === bb || measures.length >= 9 || !keys[aa] || !keys[bb]
              }
              onClick={() =>
                setMeasures([
                  ...measures,
                  { a: aa, b: bb, keyA: keys[aa], keyB: keys[bb] },
                ])
              }
            >
              <Plus size={14} />
              Add dimension
            </button>
            {measures.map((m, i) => (
              <div className="tm-dim-row" key={i}>
                <span>
                  P{m.a + 1} to P{m.b + 1}
                </span>
                <button
                  className="tm-icon"
                  title="Remove dimension"
                  aria-label={"Remove dimension " + (i + 1)}
                  onClick={() =>
                    setMeasures(measures.filter((_, j) => i !== j))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </details>
        )}
        <p className="tm-help">
          Print all sheets at 100% / actual size. SVG and DXF export the current
          sheet in paper millimetres. Projected curves use a 0.004 mm
          chord-deflection target in model space.
        </p>
      </aside>
      {editingDimension &&
        scope !== "profile" &&
        (dimensionViews ? (
          <FinishedDimensionDialog
            key={editingDimension}
            initial={savedDims.find((d) => d.id === editingDimension)}
            views={dimensionViews}
            assembly={assembly}
            values={props.values}
            snaps={snaps}
            dimensions={savedDims}
            scale={data.scale}
            onClose={() => editDimension(null)}
            onSave={(dim) => {
              setAnnotation({
                finishedDimensions:
                  editingDimension === "new"
                    ? [...savedDims, dim]
                    : savedDims.map((d) => (d.id === dim.id ? dim : d)),
              });
              wantPage(dimensionSheetName(dim.view));
              editDimension(null);
            }}
          />
        ) : (
          <Modal
            title={
              assembly ? "Dimension assembled view" : "Dimension finished view"
            }
            onClose={() => editDimension(null)}
          >
            <p className="helper">
              {projected?.error || "Projecting finished edges…"}
            </p>
          </Modal>
        ))}
    </div>
  );
}
