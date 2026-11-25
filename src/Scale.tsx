import { useState } from "react";
import { Download, Printer, Ruler } from "lucide-react";
import { ScaleAttachmentPanel } from "./ScaleAttachmentPanel";
import { boldCadFont, cadFont, isCadFont } from "./secondaryInk";
import {
  getScaleLayout,
  isScaleFeature,
  scaleDefaults as defaults,
  scaleKind as unitType,
  withScaleModel,
  type FieldKey as NumKey,
} from "./secondaryEngraving";
import {
  changeWorkspace,
  dxfFile,
  fileName,
  NumberField,
  printSheet,
  saveAs,
  SheetView,
  svgFile,
  type WorkspaceProps,
  type Sheet,
} from "./secondaryVector";
import {
  makeScale,
  outlinedGraduations,
  scaleUnits,
  type ScaleLayout,
  type ScaleUnit,
} from "./secondaryScale";
export default function Scale(
  props: WorkspaceProps & { rebuilding?: boolean },
) {
  const cfg = props.project.workspaces?.scale || {},
    patch = (data: Record<string, unknown>) =>
      changeWorkspace(props, "scale", data);
  const [notice, setNotice] = useState("");
  const expr = (key: NumKey) => String(cfg[key] ?? defaults[key]);
  const field = (key: NumKey, title: string, unit?: string) => (
    <NumberField
      key={key}
      title={title}
      expr={expr(key)}
      values={props.values}
      kind={unitType(key)}
      onCommit={(s) => patch({ [key]: s })}
      unit={unit}
    />
  );
  const top: ScaleUnit = cfg.top || "mm",
    bottom: ScaleUnit | "off" = cfg.bottom ?? "in16";
  const layout: ScaleLayout["layout"] = cfg.layout || "linear",
    font = cfg.font || cadFont;
  const stock = props.project.features.find((f) => f.id === cfg.modelId);
  const attachable = props.project.features.some(
    (f) =>
      f.operation === "new" &&
      !f.suppressed &&
      !isScaleFeature(props.project, f.id),
  );
  const [tool, setTool] = useState<"part" | "stock">(
    !attachable || (stock && !cfg.appliedId) ? "stock" : "part",
  );
  const attach = tool === "part" && attachable;
  function changeCutDimension(key: "thickness" | "depth", amount: string) {
    const id = key === "thickness" ? cfg.modelId : cfg.appliedId;
    if (!props.project.features.some((f) => f.id === id)) {
      patch({ [key]: amount });
      return;
    }
    props.onChange({
      ...props.project,
      features: props.project.features.map((f) =>
        f.id === id ? { ...f, amount } : f,
      ),
      workspaces: {
        ...props.project.workspaces,
        scale: { ...cfg, [key]: amount },
      },
    });
  }
  const [include, setInclude] = useState(false);
  const [centerlines, setCenterlines] = useState(false);
  let exported: Sheet | undefined;
  let scaleLayout,
    results,
    preview,
    err = "";
  try {
    scaleLayout = getScaleLayout(cfg, props.values);
    const made = makeScale(scaleLayout);
    preview = outlinedGraduations(made.preview, scaleLayout);
    const source = include ? made.preview : made.geometry;
    exported = centerlines ? source : outlinedGraduations(source, scaleLayout);
    results = made;
  } catch (e) {
    err = (e as Error).message;
  }
  const base =
    fileName(props.project.name) +
    "-" +
    (layout === "arc" ? "protractor" : "ruler");
  const cadLabels =
    isCadFont(font) &&
    (!scaleLayout?.bottomLabels || isCadFont(scaleLayout.bottomLabels.font));
  const fontSelect = (
    value: string,
    onChange: (font: string) => void,
    title: string,
  ) => (
    <label className="tm-field">
      <span>{title}</span>
      <select
        aria-label={title}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={cadFont}>Helvetiker · CAD outlines</option>
        <option value={boldCadFont}>Helvetiker bold · CAD outlines</option>
        <option value="Helvetica, Arial, sans-serif">
          Helvetica · editable text
        </option>
        <option value="Times New Roman, serif">Times · editable text</option>
        <option value="Courier New, monospace">Courier · editable text</option>
      </select>
    </label>
  );
  const override = (
    key: string,
    source: string,
    title: string,
    kind: "length" | "angle" | "scalar" = "length",
    unit?: string,
  ) => (
    <NumberField
      key={key}
      title={title}
      expr={String(cfg[key] ?? source)}
      values={props.values}
      kind={kind}
      unit={unit}
      onCommit={(s) => patch({ [key]: s })}
    />
  );

  return (
    <div className="tm-workspace">
      <main className="tm-work-main">
        <header className="tm-work-head">
          <div>
            <h2>Scale studio</h2>
            <p>
              {layout === "arc" ? "Arc graduations" : "Linear graduations"} ·
              engraving layout
            </p>
          </div>
          <div className="tm-segment">
            <button
              aria-pressed={layout === "linear"}
              onClick={() => patch({ layout: "linear" })}
            >
              Linear
            </button>
            <button
              aria-pressed={layout === "arc"}
              onClick={() => patch({ layout: "arc" })}
            >
              Protractor
            </button>
          </div>
        </header>
        <section className="tm-ruler-stage">
          <div className="tm-stage-caption">
            <span className="tm-dot" />
            Graduation preview
          </div>
          {results ? (
            <div
              className={"tm-ruler-paper " + (layout === "arc" ? "arc" : "")}
            >
              <SheetView name="Graduated scale preview" sheet={preview!} />
            </div>
          ) : (
            <div className="tm-empty">
              <Ruler size={32} />
              <p>{err}</p>
            </div>
          )}
        </section>
        <div className="tm-sheet-bar">
          <span className="tm-dot" />
          {results
            ? results.count + " graduation marks"
            : "Review scale dimensions"}
          <span className="tm-spacer" />
          {results &&
            results.geometry.width + " × " + results.geometry.height + " mm"}
        </div>
        <div className="tm-export-line">
          <button
            className="tm-btn accent"
            disabled={props.rebuilding || !exported}
            onClick={() =>
              exported &&
              saveAs(svgFile(exported), "image/svg+xml", base + ".svg")
            }
          >
            <Download size={14} />
            Export SVG
          </button>
          <button
            className="tm-btn"
            disabled={props.rebuilding || !exported}
            onClick={() =>
              exported &&
              saveAs(dxfFile(exported), "application/dxf", base + ".dxf")
            }
          >
            <Download size={14} />
            Export DXF
          </button>
          <button
            className="tm-btn"
            disabled={props.rebuilding || !exported}
            onClick={() => {
              if (exported && !printSheet(exported, base))
                setNotice("Allow the print window and choose Save as PDF.");
            }}
          >
            <Printer size={14} />
            Print / PDF
          </button>
        </div>
        <label className="tm-check tm-export-opt">
          <input
            type="checkbox"
            checked={include}
            onChange={(e) => setInclude(e.target.checked)}
          />
          Include blank outline in export
        </label>
        <label className="tm-check tm-export-opt">
          <input
            type="checkbox"
            checked={centerlines}
            onChange={(e) => setCenterlines(e.target.checked)}
          />
          Export tick centerlines
        </label>
        <p className="tm-work-note">
          Exports use 1:1 layout coordinates in millimetres. Part placement
          applies only to the 3D cut.{" "}
          {cadLabels
            ? "Numerals export as closed outlines."
            : "System-font labels export as editable text."}{" "}
          {centerlines
            ? "Tick paths carry the specified line widths."
            : "Closed tick outlines include the specified widths."}
        </p>
        {notice && <p className="tm-inline-error">{notice}</p>}
      </main>
      <aside className="tm-inspector">
        <h3>{layout === "arc" ? "Protractor blank" : "Ruler blank"}</h3>
        <div className="tm-pair">
          {field("length", layout === "arc" ? "Diameter" : "Length", "mm")}
          {layout === "linear"
            ? field("width", "Width", "mm")
            : field("angleSpan", "Span", "°")}
        </div>
        {field(
          "offset",
          layout === "arc" ? "Radial inset" : "Start offset",
          "mm",
        )}
        <h3>Graduations</h3>
        {layout === "linear" ? (
          <>
            <label className="tm-field">
              <span>Top edge</span>
              <select
                aria-label="Top edge"
                value={top}
                onChange={(e) => patch({ top: e.target.value })}
              >
                {Object.entries(scaleUnits).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="tm-field">
              <span>Bottom edge</span>
              <select
                aria-label="Bottom edge"
                value={bottom}
                onChange={(e) => patch({ bottom: e.target.value })}
              >
                <option value="off">None</option>
                {Object.entries(scaleUnits).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {(top === "architectural" || bottom === "architectural") &&
              field("architectureRatio", "Architectural ratio (1 ∶ N)")}
            {(top === "custom" || bottom === "custom") && (
              <>
                {field("customStep", "Minor spacing", "mm")}
                {field("customRatio", "Label units per mm")}
              </>
            )}
          </>
        ) : (
          field("angleStep", "Angular spacing", "°")
        )}
        {layout === "linear" && bottom !== "off" && (
          <p className="tm-help">
            Both edges use these tick lengths and widths.
          </p>
        )}
        <div className="tm-triple">
          {field("major", "Major", "mm")}
          {field("mid", "Mid", "mm")}
          {field("minor", "Minor", "mm")}
        </div>
        {field("weight", "Line width", "mm")}
        <details className="tm-more">
          <summary>Widths by tick rank</summary>
          {override(
            "majorWeight",
            expr("weight"),
            "Major line width",
            "length",
            "mm",
          )}
          {override(
            "midWeight",
            expr("weight"),
            "Mid line width",
            "length",
            "mm",
          )}
        </details>
        <h3>3D engraving</h3>
        {attachable && (
          <div className="tm-segment">
            <button aria-pressed={attach} onClick={() => setTool("part")}>
              Existing part
            </button>
            <button aria-pressed={!attach} onClick={() => setTool("stock")}>
              Ruler stock
            </button>
          </div>
        )}
        <div className={attach ? "" : "tm-pair"}>
          {!attach && (
            <NumberField
              title="Stock thickness"
              expr={String(stock?.amount ?? cfg.thickness ?? "2 mm")}
              values={props.values}
              unit="mm"
              valid={(d) => d > 0}
              onCommit={(value) => changeCutDimension("thickness", value)}
            />
          )}
          <NumberField
            title="Cut depth"
            expr={String(cfg.depth ?? "0.15 mm")}
            values={props.values}
            unit="mm"
            valid={(d) => d > 0}
            onCommit={(value) => changeCutDimension("depth", value)}
          />
        </div>
        {attach ? (
          <ScaleAttachmentPanel
            {...props}
            valid={!!results && !props.rebuilding}
          />
        ) : stock ? (
          <p className="tm-help">
            {stock.suppressed
              ? "Stock is suppressed in feature history."
              : "The modeled stock updates with this scale."}
          </p>
        ) : (
          <button
            className="tm-btn"
            disabled={props.rebuilding || !results}
            onClick={() => {
              try {
                props.onChange(withScaleModel(props.project, props.values));
                setNotice("");
              } catch (e) {
                setNotice((e as Error).message);
              }
            }}
          >
            Create engraved stock
          </button>
        )}
        <p className="tm-help">
          {cadLabels
            ? "CAD numeral outlines and tick widths cut to the specified depth."
            : "System typefaces are for vector text. Choose CAD outlines for solid numerals."}
        </p>
        <details className="tm-more">
          <summary>Number labels</summary>
          {fontSelect(font, (font) => patch({ font }), "Typeface")}
          <div className="tm-pair">
            {field("fontSize", "Size", "mm")}
            {field("rotation", "Rotation", "°")}
          </div>
          {field("labelGap", "Distance from ticks", "mm")}
          {field("frequency", "Every N major ticks")}
          {layout === "linear" && bottom !== "off" && (
            <>
              <label className="tm-check">
                <input
                  type="checkbox"
                  checked={!!cfg.independentLabels}
                  onChange={(e) =>
                    patch({ independentLabels: e.target.checked })
                  }
                />
                Style bottom labels separately
              </label>
              {cfg.independentLabels && (
                <>
                  {fontSelect(
                    cfg.bottomFont ?? font,
                    (bottomFont) => patch({ bottomFont }),
                    "Bottom typeface",
                  )}
                  <div className="tm-pair">
                    {override(
                      "bottomFontSize",
                      expr("fontSize"),
                      "Bottom size",
                      "length",
                      "mm",
                    )}
                    {override(
                      "bottomRotation",
                      expr("rotation"),
                      "Bottom rotation",
                      "angle",
                      "°",
                    )}
                  </div>
                  {override(
                    "bottomLabelGap",
                    expr("labelGap"),
                    "Bottom label distance",
                    "length",
                    "mm",
                  )}
                  {override(
                    "bottomFrequency",
                    expr("frequency"),
                    "Bottom label frequency",
                    "scalar",
                  )}
                </>
              )}
            </>
          )}
        </details>
      </aside>
    </div>
  );
}
