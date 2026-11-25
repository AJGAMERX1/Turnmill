import { useEffect, useRef, useState } from "react";
import {
  BoxSelect,
  FlipHorizontal2,
  Grid2X2,
  Layers,
  RotateCw,
  Spline,
  Trash2,
} from "lucide-react";
import { Modal } from "./Dialogs";
import { resolveParameters } from "./expressions";
import {
  advancedLabels,
  evaluateAdvanced,
  type Advanced,
  type Axis3,
  type FaceSide,
  type SketchMode,
} from "./advancedTypes";
import { solveSketch, type SketchSolution, type XY } from "./solveSketch";
import type { Feature, Project } from "./types";
import "./advanced.css";

type Props = {
  initialKind?: Advanced["kind"];
  project: Project;
  feature: Feature;
  onSave: (op: Advanced | undefined) => void;
  onClose: () => void;
};
const icons = {
  shell: BoxSelect,
  mirror: FlipHorizontal2,
  linearPattern: Grid2X2,
  circularPattern: RotateCw,
  sweep: Spline,
  loft: Layers,
};
const descriptions = {
  shell:
    "Remove one planar end face and give the remaining faces an inward wall thickness.",
  mirror:
    "Reflect the body across a principal plane. The offset moves that plane along its positive normal.",
  linearPattern:
    "Repeat the body along a model axis. Spacing is the signed distance between successive instances.",
  circularPattern:
    "Repeat the body around an axis through the model origin. Use a signed angle between successive instances.",
  sweep:
    "Follow an open run of edges in a path sketch. The section’s X axis points to the left of the path, and its Y axis points up along model Z.",
  loft: "Connect two closed sketch outlines on parallel XY planes. The sketch coordinates set their positions in X and Y.",
};
function initial(kind: Advanced["kind"], p: Project, f: Feature): Advanced {
  const section =
    p.sketches.find((s) => s.id === f.sketchId)?.id || p.sketches[0]?.id || "";
  const other = p.sketches.find((s) => s.id !== section)?.id || section;
  switch (kind) {
    case "shell":
      return {
        kind,
        face: f.kind === "revolve" ? "xMax" : "zMax",
        thickness: "1 mm",
      };
    case "mirror":
      return { kind, plane: "YZ", offset: "0 mm", keepOriginal: true };
    case "linearPattern":
      return { kind, axis: "Y", spacing: "20 mm", count: "3" };
    case "circularPattern":
      return { kind, axis: "Z", stepAngle: "90 deg", count: "4" };
    case "loft":
      return {
        kind,
        mode: "replace",
        lowerId: section,
        upperId: other,
        z1: "0 mm",
        z2: "15 mm",
      };
    case "sweep":
      return {
        kind,
        mode: "replace",
        sectionId: section,
        pathId: other,
        firstVertex: 0,
        lastVertex: 1,
        direction: "forward",
        z: "0 mm",
        anchorX: "0 mm",
        anchorY: "0 mm",
      };
  }
}

function PathPreview({
  project,
  op,
}: {
  project: Project;
  op: Extract<Advanced, { kind: "sweep" }>;
}) {
  const [profile, setProfile] = useState<SketchSolution>();
  const sketch = project.sketches.find((s) => s.id === op.pathId);
  useEffect(() => {
    let live = true;
    setProfile(undefined);
    if (sketch) {
      try {
        solveSketch(sketch, resolveParameters(project.parameters))
          .then((p) => {
            if (live) setProfile(p);
          })
          .catch(() => {});
      } catch {
        /* Report invalid dimensions when applying the operation. */
      }
    }
    return () => {
      live = false;
    };
  }, [sketch, project.parameters]);
  if (!profile?.points.length) return null;
  const lo = { x: Infinity, y: Infinity },
    hi = { x: -Infinity, y: -Infinity };
  for (const p of profile.points) {
    lo.x = Math.min(lo.x, p.x);
    hi.x = Math.max(hi.x, p.x);
    lo.y = Math.min(lo.y, p.y);
    hi.y = Math.max(hi.y, p.y);
  }
  const k = Math.min(
    350 / Math.max(1, hi.x - lo.x),
    65 / Math.max(1, hi.y - lo.y),
  );
  const pos = (p: XY) => [
    196 + (p.x - (hi.x + lo.x) / 2) * k,
    45 - (p.y - (hi.y + lo.y) / 2) * k,
  ];
  const selected = new Set<number>(),
    n = profile.vertices.length;
  if (
    op.firstVertex >= 0 &&
    op.firstVertex < n &&
    op.lastVertex >= 0 &&
    op.lastVertex < n
  ) {
    let i = op.firstVertex;
    for (let j = 0; j < n && i !== op.lastVertex; j++) {
      const next = (i + (op.direction === "forward" ? 1 : n - 1)) % n;
      selected.add(op.direction === "forward" ? i : next);
      i = next;
    }
  }
  return (
    <svg
      className="ad-path"
      viewBox="0 0 392 90"
      role="img"
      aria-label="Selected sweep path in the path sketch"
    >
      {profile.edgePaths.map((ps, i) => (
        <polyline
          key={i}
          points={ps.map((p) => pos(p).join(",")).join(" ")}
          fill="none"
          stroke={selected.has(i) ? "#f2bd6b" : "#596460"}
          strokeWidth={selected.has(i) ? 2.5 : 1}
        />
      ))}
      {[op.firstVertex, op.lastVertex].map((i, j) => {
        const p = profile.vertices[i];
        if (!p) return null;
        const [x, y] = pos(p);
        return (
          <g key={j}>
            <circle cx={x} cy={y} r="3.5" fill={j ? "#85bfaa" : "#f2bd6b"} />
            <text x={x + 5} y={y - 6} fill="#e7ede8" fontSize="9">
              P{i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AdvancedDialog({
  project,
  feature,
  onSave,
  onClose,
  initialKind,
}: Props) {
  const [op, setOp] = useState<Advanced>(() =>
      initialKind
        ? initial(initialKind, project, feature)
        : (feature.advanced ?? initial("shell", project, feature)),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const set = (values: Record<string, string | number | boolean>) => {
    setOp((v) => ({ ...v, ...values }) as Advanced);
    setError("");
  };
  const sketchSelect = (
    label: string,
    id: string,
    cb: (id: string) => void,
  ) => (
    <label>
      {label}
      <select value={id} onChange={(e) => cb(e.target.value)}>
        {!project.sketches.length && (
          <option value="">Create a sketch first</option>
        )}
        {project.sketches.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
  const text = (label: string, k: string, v: string) => (
    <label>
      {label}
      <input
        value={v}
        required
        spellCheck={false}
        onChange={(e) => set({ [k]: e.target.value })}
      />
    </label>
  );
  const axes = (axis: Axis3) => (
    <label>
      Axis
      <select value={axis} onChange={(e) => set({ axis: e.target.value })}>
        {["X", "Y", "Z"].map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
    </label>
  );
  const mode = (m: SketchMode) => (
    <label>
      Result
      <select value={m} onChange={(e) => set({ mode: e.target.value })}>
        <option value="replace">Replace this body</option>
        <option value="add">Add material to this body</option>
        <option value="cut">Cut material from this body</option>
      </select>
    </label>
  );
  const path =
    op.kind === "sweep"
      ? project.sketches.find((s) => s.id === op.pathId)
      : undefined;
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await evaluateAdvanced(
        op,
        project,
        resolveParameters(project.parameters),
      );
      if (open.current) onSave(op);
    } catch (e) {
      if (open.current)
        setError(
          e instanceof Error ? e.message : "Check the operation dimensions.",
        );
    } finally {
      if (open.current) setBusy(false);
    }
  }
  return (
    <Modal title="Advanced operation" onClose={onClose}>
      <span className="ad-feature">Body after {feature.name}</span>
      <div className="ad-tools" aria-label="Operation">
        {(Object.keys(advancedLabels) as Advanced["kind"][]).map((kind) => {
          const Icon = icons[kind];
          return (
            <button
              key={kind}
              aria-pressed={op.kind === kind}
              onClick={() => {
                if (op.kind !== kind) {
                  setOp(initial(kind, project, feature));
                  setError("");
                }
              }}
            >
              <Icon size={14} />
              {advancedLabels[kind]}
            </button>
          );
        })}
      </div>
      <p className="helper">{descriptions[op.kind]}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="ad-fields">
          {op.kind === "shell" && (
            <>
              <label>
                Face to open
                <select
                  value={op.face}
                  onChange={(e) => set({ face: e.target.value as FaceSide })}
                >
                  {(["X", "Y", "Z"] as const).flatMap((a) =>
                    ["Min", "Max"].map((side) => (
                      <option key={a + side} value={a.toLowerCase() + side}>
                        {a} {side === "Min" ? "minimum" : "maximum"}
                      </option>
                    )),
                  )}
                </select>
              </label>
              {text("Wall thickness", "thickness", op.thickness)}
            </>
          )}
          {op.kind === "mirror" && (
            <>
              <label>
                Mirror plane
                <select
                  value={op.plane}
                  onChange={(e) => set({ plane: e.target.value })}
                >
                  {["XY", "YZ", "XZ"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              {text("Plane offset", "offset", op.offset)}
              <label>
                Original body
                <select
                  value={String(op.keepOriginal)}
                  onChange={(e) =>
                    set({ keepOriginal: e.target.value === "true" })
                  }
                >
                  <option value="true">Keep original and mirrored copy</option>
                  <option value="false">Keep mirrored result only</option>
                </select>
              </label>
            </>
          )}
          {(op.kind === "linearPattern" || op.kind === "circularPattern") && (
            <>
              {axes(op.axis)}
              {text("Total instances", "count", op.count)}
              {op.kind === "linearPattern"
                ? text("Spacing", "spacing", op.spacing)
                : text("Angle per instance", "stepAngle", op.stepAngle)}
            </>
          )}
          {op.kind === "loft" && (
            <>
              {sketchSelect("First section", op.lowerId, (id) =>
                set({ lowerId: id }),
              )}
              {text("First Z height", "z1", op.z1)}
              {sketchSelect("Second section", op.upperId, (id) =>
                set({ upperId: id }),
              )}
              {text("Second Z height", "z2", op.z2)}
              {mode(op.mode)}
            </>
          )}
          {op.kind === "sweep" && (
            <>
              {sketchSelect("Section sketch", op.sectionId, (id) =>
                set({ sectionId: id }),
              )}
              {sketchSelect("Path sketch", op.pathId, (id) =>
                set({ pathId: id, firstVertex: 0, lastVertex: 1 }),
              )}
              {(["firstVertex", "lastVertex"] as const).map((key, j) => (
                <label key={key}>
                  {j ? "End vertex" : "Start vertex"}
                  <select
                    value={op[key]}
                    onChange={(e) => set({ [key]: Number(e.target.value) })}
                  >
                    {path?.points.map((_, i) => (
                      <option key={i} value={i}>
                        P{i + 1}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label>
                Travel along path
                <select
                  value={op.direction}
                  onChange={(e) => set({ direction: e.target.value })}
                >
                  <option value="forward">Forward through vertices</option>
                  <option value="reverse">Backward through vertices</option>
                </select>
              </label>
              {text("Path Z height", "z", op.z)}
              {text("Section anchor X", "anchorX", op.anchorX)}
              {text("Section anchor Y", "anchorY", op.anchorY)}
              {mode(op.mode)}
            </>
          )}
        </div>
        {op.kind === "sweep" && <PathPreview project={project} op={op} />}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {feature.advanced && (
            <button
              className="ad-remove"
              type="button"
              onClick={() => onSave(undefined)}
            >
              <Trash2 size={13} /> Remove
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy} type="submit">
            {busy ? "Checking…" : "Apply operation"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
