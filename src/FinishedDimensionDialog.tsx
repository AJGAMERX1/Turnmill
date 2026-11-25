import { useMemo, useState, type MouseEvent } from "react";
import { Modal } from "./Dialogs";
import { uid } from "./projects";
import {
  dimensionLayout,
  dimensionLine,
  dimensionMarks,
  findSnap,
  measureDimension,
  dimensionViewNames,
  type DimensionGeometry,
  viewName,
  type DimensionMode,
  type DimensionView,
  type FinishedDimension,
  type Snap,
} from "./drawingDimensions";
import { n, type Mark } from "./secondaryVector";
import "./drawingDimensions.css";

export type ViewSnaps = Record<DimensionView, Snap[]>;
type Props = {
  views: DimensionGeometry;
  assembly?: boolean;
  snaps: ViewSnaps;
  values: Record<string, number>;
  scale: "auto" | number;
  dimensions: FinishedDimension[];
  initial?: FinishedDimension;
  onClose: () => void;
  onSave: (draft: FinishedDimension) => void;
};
function newDimension(): FinishedDimension {
  return {
    id: uid(),
    view: "front",
    a: "",
    b: "",
    mode: "horizontal",
    offset: "8 mm",
    tolerance: "general",
    plus: "0.05 mm",
    minus: "0.05 mm",
  };
}
function previewMark(mark: Mark, index: number) {
  if (mark.type === "path")
    return (
      <polyline
        key={index}
        points={mark.pts.map((p) => p.join(",")).join(" ")}
        strokeWidth={mark.weight}
      />
    );
  if (mark.type === "text")
    return (
      <text
        key={index}
        x={mark.x}
        y={mark.y}
        textAnchor={mark.anchor}
        fontSize={mark.size}
        transform={`rotate(${mark.rotation || 0} ${mark.x} ${mark.y})`}
      >
        {mark.value}
      </text>
    );
  return null;
}
export default function FinishedDimensionDialog({
  views,
  assembly,
  snaps,
  values,
  scale,
  dimensions,
  initial,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<FinishedDimension>(() =>
    !initial
      ? newDimension()
      : views[initial.view]
        ? initial
        : { ...initial, view: "front", a: "", b: "" },
  );
  const [autoDirection, setAutoDirection] = useState(!initial);
  const [hover, setHover] = useState<Snap>();
  const view = views[draft.view] || views.front,
    items = snaps[draft.view];
  const layout = useMemo(() => dimensionLayout(view, scale), [view, scale]);
  const outline = useMemo(
    () =>
      view.paths.map((path, i) => (
        <polyline
          key={i}
          points={path.map((p) => layout.at(p).join(",")).join(" ")}
        />
      )),
    [view, layout],
  );
  const existing = useMemo(
    () =>
      dimensions
        .filter((s) => s.id !== draft.id && s.view === draft.view)
        .flatMap((spec) => {
          try {
            return dimensionMarks(
              measureDimension(spec, items, values),
              layout.at,
            );
          } catch {
            return [];
          }
        }),
    [dimensions, draft.id, draft.view, items, values, layout],
  );
  const a = findSnap(items, draft.a),
    b = findSnap(items, draft.b);
  const next = !a ? "a" : !b ? "b" : undefined;
  const broken = !!((draft.a && !a) || (draft.b && !b));
  const patch = (values: Partial<FinishedDimension>) =>
    setDraft((prev) => ({ ...prev, ...values }));
  function withPoint(which: "a" | "b", snap: Snap): Partial<FinishedDimension> {
    const other = which === "a" ? b : a;
    if (!other || !autoDirection) return { [which]: snap.key };
    const dx = Math.abs(snap.xy[0] - other.xy[0]),
      dy = Math.abs(snap.xy[1] - other.xy[1]);
    return {
      [which]: snap.key,
      mode: dx < 1e-6 ? "vertical" : dy < 1e-6 ? "horizontal" : "aligned",
    };
  }
  let preview: Mark[] = [],
    error = "",
    measurement = "";
  const candidate =
    hover && next === "b" && a && hover.key !== a.key
      ? { ...draft, ...withPoint("b", hover) }
      : draft;
  if ((a && b) || candidate !== draft)
    try {
      const measure = measureDimension(candidate, items, values);
      preview = dimensionMarks(measure, layout.at);
      measurement = measure.text + " mm";
    } catch (e) {
      error = (e as Error).message;
    }
  function placeLine(e: MouseEvent<SVGSVGElement>) {
    if (!a || !b) return;
    const svg = e.currentTarget,
      matrix = svg.getScreenCTM();
    if (!matrix) return;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const pos = p.matrixTransform(matrix.inverse());
    const { mid, normal } = dimensionLine(
      layout.at(a.xy),
      layout.at(b.xy),
      draft.mode,
    );
    patch({
      offset:
        n((pos.x - mid[0]) * normal[0] + (pos.y - mid[1]) * normal[1], 3) +
        " mm",
    });
  }
  function selector(which: "a" | "b", title: string) {
    return (
      <label>
        <span>{title}</span>
        <select
          aria-label={title}
          value={findSnap(items, draft[which])?.key || ""}
          onChange={(e) => {
            const item = findSnap(items, e.target.value);
            patch(item ? withPoint(which, item) : { [which]: "" });
          }}
        >
          <option value="">
            {draft[which] ? "Pick a replacement" : "Pick a point"}
          </option>
          {items.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name} ({s.xy.map((v) => n(v, 4)).join(", ")})
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <Modal
      title={assembly ? "Dimension assembled view" : "Dimension finished view"}
      wide
      onClose={onClose}
    >
      <div className="dim-editor">
        <div className="dim-editor-pair">
          <label>
            <span>View</span>
            <select
              aria-label="View"
              value={draft.view}
              onChange={(e) => {
                patch({ view: e.target.value as DimensionView, a: "", b: "" });
                setHover(undefined);
              }}
            >
              {dimensionViewNames
                .filter((v) => views[v])
                .map((v) => (
                  <option key={v} value={v}>
                    {viewName(v)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Measurement</span>
            <select
              aria-label="Measurement"
              value={draft.mode}
              onChange={(e) => {
                patch({ mode: e.target.value as DimensionMode });
                setAutoDirection(false);
              }}
            >
              <option value="horizontal">Horizontal distance</option>
              <option value="vertical">Vertical distance</option>
              <option value="aligned">Aligned distance</option>
            </select>
          </label>
        </div>
        <div className="dim-editor-stage">
          <svg
            role="group"
            aria-label={
              assembly
                ? "Assembly view dimension picker"
                : "Finished view dimension picker"
            }
            viewBox="8 28 281 150"
            onClick={placeLine}
          >
            <g className="dim-outline">{outline}</g>
            <g className="dim-other">{existing.map(previewMark)}</g>
            <g className="dim-live">{preview.map(previewMark)}</g>
            {items.map((s) => {
              const [x, y] = layout.at(s.xy),
                picked = s === a || s === b;
              return (
                <g
                  key={s.key}
                  className={
                    "dim-point" +
                    (picked ? " picked" : "") +
                    (s.kind === "center" ? " center" : "")
                  }
                >
                  <circle cx={x} cy={y} r={picked ? 1.65 : 1.12} />
                  {s.kind === "center" && (
                    <path d={`M ${x - 2},${y} h 4 M ${x},${y - 2} v 4`} />
                  )}
                  <circle
                    className="dim-hit"
                    role="button"
                    aria-label={
                      s.name + " (" + s.xy.map((v) => n(v, 4)).join(", ") + ")"
                    }
                    cx={x}
                    cy={y}
                    r={2.3}
                    onMouseEnter={() => setHover(s)}
                    onMouseLeave={() => setHover(undefined)}
                    onClick={(e) => {
                      if (next) {
                        e.stopPropagation();
                        patch(withPoint(next, s));
                        setHover(undefined);
                      }
                    }}
                  >
                    <title>
                      {s.name} · {s.xy.map((v) => n(v, 4)).join(", ")} mm
                    </title>
                  </circle>
                </g>
              );
            })}
          </svg>
          <div className="dim-editor-readout" aria-live="polite">
            <span>
              {!items.length
                ? "This view has no pickable endpoints or centers. Choose another view."
                : broken
                  ? "A reference disappeared. Pick its replacement."
                  : next === "a"
                    ? "Pick the first endpoint or center."
                    : next === "b"
                      ? "Pick the second endpoint or center."
                      : "Click to place the dimension line."}
            </span>
            <strong>{measurement}</strong>
          </div>
        </div>
        <div className="dim-editor-pair">
          {selector("a", "First point")}
          {selector("b", "Second point")}
        </div>
        <div className="dim-editor-pair">
          <label>
            <span>Line offset · paper mm</span>
            <input
              value={draft.offset}
              onChange={(e) => patch({ offset: e.target.value })}
            />
          </label>
          <label>
            <span>Dimension tolerance</span>
            <select
              aria-label="Dimension tolerance"
              value={draft.tolerance}
              onChange={(e) =>
                patch({
                  tolerance: e.target.value as FinishedDimension["tolerance"],
                })
              }
            >
              <option value="general">Use sheet tolerance</option>
              <option value="symmetric">Symmetric (±)</option>
              <option value="bilateral">Upper and lower allowances</option>
            </select>
          </label>
        </div>
        {draft.tolerance !== "general" && (
          <div className="dim-editor-pair">
            <label>
              <span>
                {draft.tolerance === "symmetric"
                  ? "Symmetric allowance"
                  : "Upper allowance"}
              </span>
              <input
                value={draft.plus}
                onChange={(e) => patch({ plus: e.target.value })}
              />
            </label>
            {draft.tolerance === "bilateral" && (
              <label>
                <span>Lower allowance</span>
                <input
                  value={draft.minus}
                  onChange={(e) => patch({ minus: e.target.value })}
                />
              </label>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!a || !b || !!error}
            onClick={() => onSave(draft)}
          >
            Save dimension
          </button>
        </div>
      </div>
    </Modal>
  );
}
