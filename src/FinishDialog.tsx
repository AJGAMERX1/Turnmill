import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
  type ReactNode,
} from "react";
import { Check, Eye, LoaderCircle, Plus, Trash2 } from "lucide-react";
import "./finishDialog.css";
import { svgArtwork } from "./markArtwork";
import { Modal } from "./Dialogs";
import { uid } from "./projects";
import { resolveParameters } from "./expressions";
import {
  evaluateFinish,
  finishLabels,
  threadPresets,
  type Finish,
  type FinishKind,
  type EvaluatedFinish,
} from "./finishingTypes";
import type { Project, Feature } from "./types";
import { GripSettings, initialGripBand } from "./GripSettings";

import type { GripStock } from "./gripBands";

export type GripRequest = {
  featureId: string;
  beforeFinishId?: string;
  priorFinishes?: EvaluatedFinish[];
};
type Props = {
  initialKind?: FinishKind;
  gripStock?: GripStock & { beforeFinishId?: string; priorKey?: string; error?: string };
  onGripRequest: (request?: GripRequest) => void;
  values: Record<string, number>;
  measurementError?: string;
  initialFinishId?: string;
  onPreview?: (finishes: Finish[]) => Promise<{ ok: boolean; message: string }>;
  onClearPreview?: () => void;
  previewPanel?: ReactNode;
  feature: Feature;
  project: Project;
  onSave: (finishes: Finish[]) => void;
  onClose: () => void;
};
export default function FinishDialog({
  feature,
  project,
  onSave,
  onClose,
  initialKind,
  initialFinishId,
  gripStock, onGripRequest, values, measurementError,
  onPreview,
  onClearPreview,
  previewPanel,
}: Props) {
  const turning = feature.kind === "revolve";
  function fresh(kind: FinishKind): Finish {
    const base = { id: uid(), name: finishLabels[kind], end: "end" as const };
    if (kind === "fillet" || kind === "chamfer")
      return { ...base, kind, size: "0.2 mm", rims: "outer" };
    if (kind === "hole")
      return {
        ...base,
        kind,
        diameter: "8 mm",
        length: "4 mm",
        profile: "straight",
        termination: "blind",
      };
    if (kind === "grip")
      return { ...base, kind, end: "start", style: "rings", count: "6", offset: "2 mm", length: "10 mm", width: "0.6 mm", depth: "0.18 mm" };
    if (kind === "knurl")
      return {
        ...base,
        kind,
        end: "start",
        style: "straight",
        diameter: project.parameters.some((p) => p.name === "outer_diameter")
          ? "outer_diameter"
          : "10 mm",
        length: "5 mm",
        depth: "0.2 mm",
        offset: "4 mm",
        count: "16",
        angle: "30 deg",
      };
    if (kind === "mark")
      return {
        ...base,
        kind,
        end: "start",
        content: "text",
        text: "PEN",
        method: "engrave",
        height: "2 mm",
        depth: "0.15 mm",
        offset: "5 mm",
        rotation: "0 deg",
      };
    return {
      ...base,
      kind,
      side: "external",
      hand: "right",
      mode: "modeled",
      preset: "Custom",
      pitch: project.parameters.some((p) => p.name === "thread_pitch")
        ? "thread_pitch"
        : "0.75 mm",
      length: "4.5 mm",
      diameter:
        feature.id === "barrel-revolve" ? "outer_diameter - 2.3 mm" : "8 mm",
    };
  }
  const [rows, writeRows] = useState<Finish[]>(() =>
    initialKind
      ? [...(feature.finishes || []), fresh(initialKind)]
      : feature.finishes?.length
        ? structuredClone(feature.finishes)
        : [fresh("chamfer")],
  );
  const [index, setIndex] = useState(() =>
    initialKind
      ? rows.length - 1
      : Math.max(
          0,
          rows.findIndex((row) => row.id === initialFinishId),
        ),
  );
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<"idle" | "pending" | "ready">("idle");
  const previewRegion = useRef<HTMLElement>(null);
  const showPanel = Boolean(previewPanel);
  useLayoutEffect(() => {
    if (showPanel && preview === "ready")
      previewRegion.current?.scrollIntoView({ block: "nearest" });
  }, [preview, showPanel]);
  const [previewMessage, setPreviewMessage] = useState("");
  const [readingGraphic, setReadingGraphic] = useState(false);
  const previewToken = useRef(0);
  const graphicToken = useRef(0);
  const previewActive = useRef(false);
  const verified = useRef<Finish[] | null>(null);
  const clearPreview = useRef(onClearPreview);
  clearPreview.current = onClearPreview;
  useEffect(
    () => () => {
      previewToken.current++;
      graphicToken.current++;
      if (previewActive.current) {
        previewActive.current = false;
        clearPreview.current?.();
      }
    },
    [],
  );
  function invalidate() {
    previewToken.current++;
    graphicToken.current++;
    verified.current = null;
    if (previewActive.current) {
      previewActive.current = false;
      clearPreview.current?.();
    }
    setReadingGraphic(false);
    setPreview("idle");
    setPreviewMessage("");
    setError("");
  }
  function setRows(next: SetStateAction<Finish[]>) {
    invalidate();
    writeRows(next);
  }
  function close() {
    invalidate();
    onClose();
  }
  const editBase = useRef({ project, featureId: feature.id });
  useLayoutEffect(() => {
    if (
      editBase.current.project !== project ||
      editBase.current.featureId !== feature.id
    )
      close();
  }, [project, feature.id, onClose]);
  async function checkDraft(apply: boolean) {
    if (preview === "pending" || readingGraphic || (waitingForStock && !active.suppressed)) return;
    if (apply && verified.current === rows) {
      onSave(rows);
      return;
    }
    const token = ++previewToken.current;
    setError("");
    try {
      const values = resolveParameters(project.parameters);
      for (const row of rows) {
        if (!row.name.trim())
          throw Error(
            "Enter a name for each finish so it can be found in history.",
          );
        if (!row.suppressed) evaluateFinish(row, values);
      }
      if (onPreview) {
        previewActive.current = true;
        setPreview("pending");
        setPreviewMessage(
          apply ? "Checking the solid before applying…" : "Building preview…",
        );
        const result = await onPreview(rows);
        if (previewToken.current !== token) return;
        if (!result.ok)
          throw Error(
            result.message ||
              "This finish could not be built. Check its dimensions and placement.",
          );
        verified.current = rows;
        setPreview("ready");
        setPreviewMessage(result.message || "Preview ready.");
      }
      if (apply) onSave(rows);
    } catch (cause) {
      if (previewToken.current !== token) return;
      if (previewActive.current) {
        previewActive.current = false;
        clearPreview.current?.();
      }
      verified.current = null;
      setPreview("idle");
      setPreviewMessage("");
      setError(
        cause instanceof Error
          ? cause.message
          : "Check the finish settings and try again.",
      );
    }
  }
  const active = rows[index];
  const editingGrip = active?.kind === "grip";
  const autoPlace = useRef(new Set(initialKind === "grip" && rows.length ? [rows[rows.length - 1].id] : []));
  const beforeFinishId = feature.finishes?.find(f => f.id === active?.id)?.id;
  const inspection = useMemo(() => {
    if (!editingGrip) return {};
    const source = feature.finishes ?? [];
    const before = beforeFinishId ? source.findIndex(f => f.id === beforeFinishId) : source.length;
    const prior = rows.slice(0, index).filter(f => !f.suppressed);
    const saved = source.slice(0, before).filter(f => !f.suppressed);
    try {
      const priorFinishes = !source[before]?.suppressed && JSON.stringify(prior) === JSON.stringify(saved)
        ? undefined : prior.map(f => evaluateFinish(f, values));
      return { request: { featureId: feature.id, beforeFinishId, priorFinishes } };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Check the dimensions of the preceding finish." };
    }
  }, [editingGrip, rows, index, feature, beforeFinishId, values]);
  const requestKey = JSON.stringify(inspection.request);
  useLayoutEffect(() => {
    onGripRequest(inspection.request);
    return () => onGripRequest(undefined);
  }, [onGripRequest, requestKey]);
  const measured = inspection.request && gripStock?.beforeFinishId === beforeFinishId &&
    gripStock?.priorKey === JSON.stringify(inspection.request.priorFinishes) ? gripStock : undefined;
  const stockIssue = inspection.error || measured?.error || (!measured && measurementError);
  const waitingForStock = editingGrip && !stockIssue && !measured;
  useLayoutEffect(() => {
    if (active?.kind !== "grip" || !measured?.bands.length || !autoPlace.current.delete(active.id)) return;
    const patch = initialGripBand(active, measured, values);
    if (patch) setRows(all => all.map(row => row.id === active.id ? { ...row, ...patch } as Finish : row));
  }, [active, measured, values]);
  const gripShortcut = (initialKind === "grip" ||
    feature.finishes?.some(f => f.id === initialFinishId && f.kind === "grip")) && editingGrip;

  const update = (patch: Record<string, unknown>) => {
    if (active?.kind === "grip" && ["offset","length","width","depth","end"].some(key => key in patch))
      autoPlace.current.delete(active.id);
    setRows((old) =>
      old.map((r, i) => (i === index ? ({ ...r, ...patch } as Finish) : r)),
    );
  };
  const field = (label: string, key: string, value: string) => (
    <label>
      {label}
      <input
        required
        value={value}
        onChange={(e) =>
          update({
            [key]: e.target.value,
            ...(active.kind === "thread" &&
            (key === "diameter" || key === "pitch")
              ? { preset: "Custom" }
              : {}),
          })
        }
      />
    </label>
  );
  const historyFields = active && <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 12,
        }}
      >
        <label
          style={{ display: "flex", alignItems: "center", gap: 7 }}
        >
          <input
            style={{ width: 15 }}
            type="checkbox"
            checked={!active.suppressed}
            onChange={(e) => update({ suppressed: !e.target.checked })}
          />
          Enabled
        </label>
        <button
          type="button"
          disabled={index === 0}
          title="Move finish earlier"
          onClick={() => {
            const next = [...rows];
            [next[index], next[index - 1]] = [
              next[index - 1],
              next[index],
            ];
            setRows(next);
            setIndex(index - 1);
          }}
        >
          ↑
        </button>
        <button
          type="button"
          disabled={index === rows.length - 1}
          title="Move finish later"
          onClick={() => {
            const next = [...rows];
            [next[index], next[index + 1]] = [
              next[index + 1],
              next[index],
            ];
            setRows(next);
            setIndex(index + 1);
          }}
        >
          ↓
        </button>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            setRows(rows.filter((_, i) => i !== index));
            setIndex(Math.max(0, index - 1));
          }}
        >
          <Trash2 size={14} /> Remove finish
        </button>
      </div>
      <label>
        Finish name
        <input
          value={active.name}
          required
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
  </>;
  return (
    <Modal title={editingGrip ? "Grip milling · " + feature.name : "Finish " + feature.name} onClose={close}>
      <div className="finish-layout" data-has-panel={showPanel}>
        {previewPanel && (
          <section
            ref={previewRegion}
            className="finish-geometry"
            aria-label="Machining preview"
          >
            {previewPanel}
          </section>
        )}
        <form
          className="finish-form"
          data-preview={preview}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void checkDraft(true);
          }}
        >
          {!gripShortcut && <div
            style={{
              display: "flex",
              gap: 5,
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            {rows.map((f, i) => (
              <button
                key={f.id}
                type="button"
                className={i === index ? "selected" : ""}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              >
                {f.name}
                {f.suppressed ? " · off" : ""}
              </button>
            ))}
            <button
              type="button"
              aria-label="Add finish"
              className="icon"
              onClick={() => {
                setRows([...rows, fresh("chamfer")]);
                setIndex(rows.length);
              }}
            >
              <Plus size={16} />
            </button>
          </div>}
          {active && (
            <>
              {!gripShortcut && <div className="two-cols">
                <label>
                  Operation
                  <select
                    aria-label="Operation"
                    value={active.kind}
                    onChange={(e) => {
                      const next = fresh(e.target.value as FinishKind);
                      if (next.kind === "grip") autoPlace.current.add(active.id);
                      else autoPlace.current.delete(active.id);
                      setRows((old) =>
                        old.map((r, i) =>
                          i === index ? { ...next, id: r.id } : r,
                        ),
                      );
                    }}
                  >
                    {Object.entries(finishLabels).map(([k, name]) => (
                      <option key={k} value={k}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                {!editingGrip && <label>
                  End
                  <select
                    aria-label="End"
                    value={active.end}
                    onChange={(e) => update({ end: e.target.value })}
                  >
                    <option value="start">
                      Start · minimum {turning || active.kind === "mark" ? "X" : "Z"}
                    </option>
                    <option value="end">
                      End · maximum {turning || active.kind === "mark" ? "X" : "Z"}
                    </option>
                  </select>
                </label>}
              </div>}
              {active.kind === "grip" && <GripSettings grip={active} update={update} field={field}
                stock={measured} values={values} stockMessage={stockIssue ? "Surface placement unavailable. " + stockIssue
                  : waitingForStock ? "Measuring barrel surfaces…" : undefined}/>}
              {(active.kind === "fillet" || active.kind === "chamfer") && (
                <div className="two-cols">
                  {field(
                    active.kind === "fillet" ? "Radius" : "Distance",
                    "size",
                    active.size,
                  )}
                  {turning && (
                    <label>
                      Rim
                      <select
                        aria-label="Rim"
                        value={active.rims}
                        onChange={(e) => update({ rims: e.target.value })}
                      >
                        <option value="outer">Outer rim</option>
                        <option value="inner">Bore rim</option>
                        <option value="all">All end rims</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
              {active.kind === "hole" && (
                <>
                  <div className="two-cols">
                    <label>
                      Hole profile
                      <select
                        aria-label="Hole profile"
                        value={active.profile || "straight"}
                        onChange={(e) => {
                          const profile = e.target.value;
                          update({
                            profile,
                            ...(profile === "straight"
                              ? {}
                              : {
                                  seatDiameter:
                                    active.seatDiameter ??
                                    "(" + active.diameter + ") + 0.5 mm",
                                }),
                            ...(profile === "counterbore"
                              ? { seatDepth: active.seatDepth ?? "1 mm" }
                              : {}),
                            ...(profile === "countersink"
                              ? { seatAngle: active.seatAngle ?? "90 deg" }
                              : {}),
                          });
                        }}
                      >
                        <option value="straight">Straight</option>
                        <option value="counterbore">Counterbore</option>
                        <option value="countersink">Countersink</option>
                      </select>
                    </label>
                    <label>
                      Termination
                      <select
                        aria-label="Termination"
                        value={active.termination || "blind"}
                        onChange={(e) =>
                          update({ termination: e.target.value })
                        }
                      >
                        <option value="blind">Blind</option>
                        <option value="through">Through all</option>
                      </select>
                    </label>
                  </div>
                  <div className="two-cols">
                    {field("Diameter", "diameter", active.diameter)}
                    {active.termination !== "through" &&
                      field("Depth", "length", active.length)}
                  </div>
                  {active.profile === "counterbore" && (
                    <div className="two-cols">
                      {field(
                        "Counterbore diameter",
                        "seatDiameter",
                        active.seatDiameter ?? "",
                      )}
                      {field(
                        "Counterbore depth",
                        "seatDepth",
                        active.seatDepth ?? "",
                      )}
                    </div>
                  )}
                  {active.profile === "countersink" && (
                    <div className="two-cols">
                      {field(
                        "Countersink diameter",
                        "seatDiameter",
                        active.seatDiameter ?? "",
                      )}
                      {field(
                        "Included angle",
                        "seatAngle",
                        active.seatAngle ?? "",
                      )}
                    </div>
                  )}
                  <details key={active.id} className="hole-placement">
                    <summary>Hole position</summary>
                    <p className="helper">
                      Measure offsets from{" "}
                      {turning
                        ? "the turning axis"
                        : "the center of the body's XY bounds"}{" "}
                      using the model axes.
                    </p>
                    <div className="two-cols">
                      {field(
                        (turning ? "Y" : "X") + " offset",
                        "offsetU",
                        active.offsetU ?? "0 mm",
                      )}
                      {field(
                        (turning ? "Z" : "Y") + " offset",
                        "offsetV",
                        active.offsetV ?? "0 mm",
                      )}
                    </div>
                  </details>
                </>
              )}
              {active.kind === "knurl" && (
                <>
                  <div className="two-cols">
                    <label>
                      Pattern
                      <select
                        aria-label="Pattern"
                        value={active.style}
                        onChange={(e) => update({ style: e.target.value })}
                      >
                        <option value="straight">Straight</option>
                        <option value="diamond">Diamond</option>
                      </select>
                    </label>
                    {field("Grooves per direction", "count", active.count)}
                  </div>
                  <div className="two-cols">
                    {field("Cylinder diameter", "diameter", active.diameter)}
                    {field("Cut depth", "depth", active.depth)}
                  </div>
                  <div className="two-cols">
                    {field("Band length", "length", active.length)}
                    {field("Offset from end", "offset", active.offset)}
                  </div>
                  {active.style === "diamond" &&
                    field("Helix angle to the axis", "angle", active.angle)}
                  <p className="helper">
                    The selected band needs a cylindrical surface along its full
                    length. The pattern cuts V-grooves into the body.
                  </p>
                </>
              )}
              {active.kind === "mark" && (
                <>
                  <div className="two-cols">
                    <label>
                      Artwork
                      <select
                        aria-label="Artwork"
                        value={active.content}
                        onChange={(e) => update({ content: e.target.value })}
                      >
                        <option value="text">Text</option>
                        <option value="graphic">SVG graphic</option>
                      </select>
                    </label>
                    <label>
                      Method
                      <select
                        aria-label="Method"
                        value={active.method}
                        onChange={(e) => update({ method: e.target.value })}
                      >
                        <option value="engrave">Engrave</option>
                        <option value="emboss">Emboss</option>
                      </select>
                    </label>
                  </div>
                  {active.content === "text" ? (
                    field("Inscription", "text", active.text)
                  ) : (
                    <label>
                      Filled SVG
                      {active.graphicName ? " · " + active.graphicName : ""}
                      <input
                        type="file"
                        accept=".svg,image/svg+xml"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          invalidate();
                          const token = ++graphicToken.current;
                          setReadingGraphic(true);
                          try {
                            const artwork = svgArtwork(await file.text());
                            if (token === graphicToken.current)
                              update({ artwork, graphicName: file.name });
                          } catch (cause) {
                            if (token === graphicToken.current)
                              setError((cause as Error).message);
                          } finally {
                            if (token === graphicToken.current)
                              setReadingGraphic(false);
                          }
                        }}
                      />
                    </label>
                  )}
                  <div className="two-cols">
                    {field("Artwork height", "height", active.height)}
                    {field(
                      active.method === "emboss"
                        ? "Relief height"
                        : "Cut depth",
                      "depth",
                      active.depth,
                    )}
                  </div>
                  <div className="two-cols">
                    {field("Offset from end", "offset", active.offset)}
                    {field(
                      turning ? "Angle around barrel" : "Angle on top face",
                      "rotation",
                      active.rotation,
                    )}
                  </div>
                  <p className="helper">
                    {turning
                      ? "The mark projects onto the cylinder. Cut depth and relief height are measured radially."
                      : "The mark is centered across the upper face. Its offset is measured along X."}
                  </p>
                </>
              )}
              {active.kind === "thread" && (
                <>
                  <label>
                    Thread size
                    <select
                      aria-label="Thread size"
                      value={active.preset}
                      onChange={(e) => {
                        const p = threadPresets.find(
                          (p) => p.label === e.target.value,
                        );
                        update(
                          p
                            ? {
                                preset: p.label,
                                diameter: p.diameter,
                                pitch: p.pitch,
                              }
                            : { preset: "Custom" },
                        );
                      }}
                    >
                      <option>Custom</option>
                      {threadPresets.map((p) => (
                        <option key={p.label}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="two-cols">
                    {field("Major diameter", "diameter", active.diameter)}
                    {field("Pitch", "pitch", active.pitch)}
                  </div>
                  <div className="two-cols">
                    {field("Threaded length", "length", active.length)}
                    <label>
                      Surface
                      <select
                        aria-label="Surface"
                        value={active.side}
                        onChange={(e) => update({ side: e.target.value })}
                      >
                        <option value="external">External shaft</option>
                        <option value="internal">Internal bore</option>
                      </select>
                    </label>
                  </div>
                  <div className="two-cols">
                    <label>
                      Geometry
                      <select
                        aria-label="Geometry"
                        value={active.mode}
                        onChange={(e) => update({ mode: e.target.value })}
                      >
                        <option value="modeled">Modeled helix</option>
                        <option value="cosmetic">Cosmetic guide</option>
                      </select>
                    </label>
                    <label>
                      Hand
                      <select
                        aria-label="Hand"
                        value={active.hand}
                        onChange={(e) => update({ hand: e.target.value })}
                      >
                        <option value="right">Right-hand</option>
                        <option value="left">Left-hand</option>
                      </select>
                    </label>
                  </div>
                  <p className="helper">
                    {active.mode === "cosmetic"
                      ? "The guide appears in the viewport and saves with the project. STEP and STL retain the smooth solid."
                      : "A single-start 60° groove is cut into the solid. The tool prepares the shaft diameter or pilot bore over the chosen length. Dimensions are nominal and have no fit allowance."}
                  </p>
                </>
              )}
            </>
          )}
          {gripShortcut ? <details className="grip-history">
            <summary>History settings</summary>{historyFields}
          </details> : historyFields}
          <div className="finish-footer">
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            {previewMessage && (
              <p role="status" className="finish-preview-status">
                {preview === "pending" ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}
                {previewMessage}
              </p>
            )}
            <div className="dialog-actions">
              {onPreview && (
                <button
                  type="button"
                  className="finish-preview-button"
                  disabled={preview === "pending" || readingGraphic || (waitingForStock && !active?.suppressed)}
                  onClick={() => void checkDraft(false)}
                >
                  <Eye size={15} />
                  Preview
                </button>
              )}
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={preview === "pending" || readingGraphic || (waitingForStock && !active?.suppressed)}
              >
                {editingGrip ? "Apply grip" : "Apply finishes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
