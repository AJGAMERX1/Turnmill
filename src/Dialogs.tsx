import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  X,
  Plus,
  Trash2,
  RotateCw,
  Ruler,
  Box,
  FilePlus2,
} from "lucide-react";
import type { Project, Feature, Parameter, Sketch } from "./types";
import { evaluate, resolveParameters } from "./expressions";
import { uid } from "./projects";
import { solveSketch } from "./solveSketch";
import { axisCrossingMessage, crossesRevolveAxis } from "./revolveAxis";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    const prev = document.activeElement as HTMLElement;
    el?.showModal();
    return () => {
      el?.close();
      prev?.focus();
    };
  }, []);
  return (
    <dialog
      className={"tm-dialog " + className + (wide ? " wide" : "")}
      aria-label={title}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-title">
        <h2>{title}</h2>
        <button className="icon" aria-label="Close dialog" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ParameterDialog({
  project,
  onSave,
  onClose,
}: {
  project: Project;
  onSave: (p: Parameter[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(project.parameters.map((p) => ({ ...p }))),
    [err, setErr] = useState("");
  let values: Record<string, number> = {};
  try {
    values = resolveParameters(rows);
  } catch {}
  const update = (i: number, k: keyof Parameter, v: string) =>
    setRows((old) => old.map((p, j) => (i === j ? { ...p, [k]: v } : p)));
  return (
    <Modal title="Named parameters" onClose={onClose} wide>
      <p className="helper">
        Use a name in any dimension. Expressions accept fractions, units, and
        formulas such as <code>barrel_length/2 + 3</code>.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            resolveParameters(rows);
            onSave(rows);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <div className="param-table">
          <div className="param-row hd">
            <span>Name</span>
            <span>Expression</span>
            <span>Type</span>
            <span>Value</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div className="param-row" key={i}>
              <input
                aria-label={"Parameter name " + (i + 1)}
                value={r.name}
                onChange={(e) => update(i, "name", e.target.value)}
              />
              <input
                aria-label={"Expression for " + r.name}
                value={r.expression}
                onChange={(e) => update(i, "expression", e.target.value)}
              />
              <select
                aria-label={"Type for " + r.name}
                value={r.kind || "length"}
                onChange={(e) => update(i, "kind", e.target.value)}
              >
                <option value="length">Length</option>
                <option value="angle">Angle</option>
                <option value="scalar">Number</option>
              </select>
              <code>
                {Number.isFinite(values[r.name])
                  ? +values[r.name].toFixed(4)
                  : "—"}
              </code>
              <button
                type="button"
                className="icon"
                aria-label={"Delete " + r.name}
                onClick={() => setRows((old) => old.filter((_, j) => i !== j))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="text-btn"
          onClick={() =>
            setRows([
              ...rows,
              { name: "dimension_" + (rows.length + 1), expression: "1 mm" },
            ])
          }
        >
          <Plus size={15} /> Add parameter
        </button>
        {err && (
          <p className="error-text" role="alert">
            {err}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Apply parameters</button>
        </div>
      </form>
    </Modal>
  );
}
export function FeatureDialog({
  project,
  scopedPart = false,
  editingProfile,
  onKindChange,
  initial,
  preferred,
  suggestedName,
  sketchId,
  onEditSketch,
  onSave,
  onClose,
}: {
  project: Project;
  scopedPart?: boolean;
  editingProfile: boolean;
  onKindChange: (kind: "revolve" | "extrude") => void;
  initial?: Feature;
  preferred: "revolve" | "extrude";
  suggestedName?: string;
  sketchId?: string;
  onEditSketch: (sketch: Sketch) => void;
  onSave: (f: Feature, s?: Sketch) => void;
  onClose: () => void;
}) {
  const fresh = !initial, kind = preferred;
  const [name, setName] = useState(
    initial?.name || suggestedName ||
      (preferred === "revolve" ? "Revolve" : "Extrude") +
        " " +
        (project.features.length + 1),
  );
  const [source, setSource] = useState(
    initial?.sketchId || sketchId || project.sketches.at(-1)?.id || "create",
  );
  const [amount, setAmount] = useState(
      initial?.amount || (preferred === "revolve" ? "360 deg" : "4 mm"),
    ),
    [op, setOp] = useState<Feature["operation"]>(initial?.operation || (scopedPart && project.features.length ? "add" : "new")),
    [err, setErr] = useState("");
  const previousKind = useRef(kind);
  useEffect(() => {
    if (previousKind.current === kind) return;
    previousKind.current = kind;
    setAmount(kind === "revolve" ? "360 deg" : "4 mm");
  }, [kind]);
  const sketch = project.sketches.find((s) => s.id === source);
  const [axisCheck, setAxisCheck] = useState<{
    sketch: Sketch; parameters: Parameter[]; problem: string;
  }>();
  useEffect(() => {
    if (kind !== "revolve" || !sketch) return;
    let current = true;
    async function check(profile: Sketch) {
      let problem = "";
      try {
        const solved = await solveSketch(profile, resolveParameters(project.parameters));
        if (crossesRevolveAxis(solved.points.map(({ x, y }) => [x, y]))) problem = axisCrossingMessage;
      } catch (e) {
        problem = (e as Error).message;
      }
      if (current) setAxisCheck({ sketch: profile, parameters: project.parameters, problem });
    }
    void check(sketch);
    return () => { current = false; };
  }, [kind, sketch, project.parameters]);
  const checking = kind === "revolve" && !!sketch &&
    (axisCheck?.sketch !== sketch || axisCheck.parameters !== project.parameters);
  const axisProblem = kind === "revolve" && sketch && !checking ? axisCheck?.problem : "";
  const submit = () => {
    if (checking || axisProblem) return;
    try {
      const n = evaluate(
        amount,
        resolveParameters(project.parameters),
        kind === "revolve" ? "angle" : "length",
      );
      if (!n || (kind === "revolve" && Math.abs(n) > 360))
        throw Error("Choose a nonzero distance or a rotation up to 360°.");
      const s =
        source === "create"
          ? {
              id: uid(),
              name: "Profile " + (project.sketches.length + 1),
              constraints: [],
              points:
                kind === "revolve"
                  ? [
                      { x: "0", y: "2" },
                      { x: "0", y: "5" },
                      { x: "35", y: "5" },
                      { x: "35", y: "2" },
                    ]
                  : [
                      { x: "0", y: "0" },
                      { x: "25", y: "0" },
                      { x: "25", y: "12" },
                      { x: "0", y: "12" },
                    ],
            }
          : undefined;
      const preceding = initial
        ? project.features.slice(
            0,
            project.features.findIndex((f) => f.id === initial.id),
          )
        : project.features;
      const body = preceding
        .filter((f) => f.operation === "new" && !f.suppressed)
        .at(-1);
      if (op !== "new" && !body)
        throw Error("Create a body before adding or cutting material.");
      onSave(
        {
          ...initial,
          id: initial?.id || uid(),
          name: name.trim() || kind,
          kind,
          sketchId: s?.id || source,
          amount,
          operation: op,
          suppressed: initial?.suppressed || false,
          bodyId: op === "new" ? undefined : body?.id,
        },
        s,
      );
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  // Keep the unfinished feature form mounted while its source sketch is being repaired.
  if (editingProfile) return null;
  return (
    <Modal title={fresh ? "Create feature" : "Edit feature"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="choice-row">
          {(["revolve", "extrude"] as const).map((k) => (
            <button
              type="button"
              key={k}
              className={kind === k ? "selected" : ""}
              onClick={() => onKindChange(k)}
            >
              {k === "revolve" ? <RotateCw size={17} /> : <Box size={17} />}{" "}
              {k === "revolve" ? "Revolve" : "Extrude"}
            </button>
          ))}
        </div>
        <label>
          Feature name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Sketch profile
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {project.sketches.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="create">New starter profile</option>
          </select>
        </label>
        <div className="two-cols">
          <label>
            {kind === "revolve" ? "Angle about X" : "Depth along Z"}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label>
            Operation
            <select
              value={op}
              onChange={(e) => setOp(e.target.value as Feature["operation"])}
            >
              {(!scopedPart || !project.features.length || initial?.operation === "new") && <option value="new">New body</option>}
              {(!scopedPart || (project.features.length > 0 && initial?.operation !== "new")) && <>
                <option value="add">Add material</option>
                <option value="cut">Cut material</option>
              </>}
            </select>
          </label>
        </div>
        {kind === "revolve" && (axisProblem && sketch ? (
          <div role="alert" className="error-text">
            <p>{axisProblem}</p>
            <button type="button" className="outline-btn" onClick={() => onEditSketch(sketch)}>Edit sketch</button>
          </div>
        ) : <p className="muted">The horizontal dashed line at Y = 0 is the turning axis. A profile that touches it makes a solid center. A gap leaves a bore.</p>)}
        {err && (
          <p className="error-text" role="alert">
            {err}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!!axisProblem || checking}>
            {fresh ? "Create feature" : "Apply changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function NewProjectDialog({
  onChoose,
  onClose,
}: {
  onChoose: (mode: "turned" | "blank" | "pen" | "ruler" | "guided") => void;
  onClose: () => void;
}) {
  return (
    <Modal title="New project" onClose={onClose}>
      <div className="project-choices">
        <button onClick={() => onChoose("guided")}><RotateCw/><div><b>Guided twist pen</b><small>Build the barrel, assemble the mechanism and make its drawing.</small></div></button>
        <button onClick={() => onChoose("turned")}>
          <RotateCw />
          <div>
            <b>Turned part</b>
            <small>
              Start with an editable barrel, bore, and turning axis.
            </small>
          </div>
        </button>
        <button onClick={() => onChoose("pen")}>
          <Box />
          <div>
            <b>Twist pen assembly</b>
            <small>
              Four editable parts, modeled threads, and linked cap and refill
              joints.
            </small>
          </div>
        </button>
        <button onClick={() => onChoose("ruler")}>
          <Ruler />
          <div>
            <b>Pocket ruler</b>
            <small>
              Metric and fractional-inch graduations engraved on a 54 mm blank.
            </small>
          </div>
        </button>
        <button onClick={() => onChoose("blank")}>
          <FilePlus2 />
          <div>
            <b>Blank part</b>
            <small>Draw your own profile and choose a feature.</small>
          </div>
        </button>
      </div>
    </Modal>
  );
}
export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <span>{children}</span>
      {action}
    </div>
  );
}
