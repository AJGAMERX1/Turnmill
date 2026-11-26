import { useEffect, useMemo, useRef, useState } from "react";
import InputValue from "./InputValue";
import { evaluate, resolveParameters } from "./expressions";
import { changeProfileRange, profileRange, type ProfileRange } from "./profileSizing";
import { isExpression, solveSketch, type XY } from "./solveSketch";
import { axisCrossingMessage, crossesRevolveAxis } from "./revolveAxis";
import type { Constraint, Feature, Project, Sketch } from "./types";

function Row({ label, value, edit }: { label: string; value: string; edit: (s: string) => void }) {
  return <label className="dim-field"><span>{label}</span><div>
    <InputValue label={label} value={value} onCommit={edit} />
  </div></label>;
}
function driverLabel(c: Constraint) {
  const [i, j] = c.indices;
  switch (c.type) {
    case "arc": return `Edge ${i + 1} signed radius`;
    case "angle": return `Edge ${i + 1} angle from X`;
    case "length": return `Edge ${i + 1} length`;
    case "distance": return `P${i + 1}–P${j + 1} distance`;
    default: return "";
  }
}

export default function SelectionDimensions({ project, sketch, feature, onChange }: {
  project: Project; sketch?: Sketch; feature?: Feature; onChange: (p: Project) => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [point, setPoint] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [solved, setSolved] = useState<{ sketch: Sketch; vertices: XY[] }>();
  const latest = useRef<Project | null>(project);
  latest.current = project;
  useEffect(() => () => { latest.current = null; }, []);
  const values = useMemo(() => {
    try { return resolveParameters(project.parameters); } catch { return undefined; }
  }, [project.parameters]);
  const turned = feature?.kind === "revolve" || (!feature && sketch?.sizing?.y?.radial === true);
  const ranges = useMemo(() => {
    if (!sketch || !values) return [];
    try {
      return (["x", "y"] as const).map((axis) => profileRange(sketch, axis, turned, values))
        .filter((r): r is ProfileRange => !!r);
    } catch { return []; }
  }, [sketch, values, turned]);
  const drivers = sketch?.constraints.filter((c) => driverLabel(c)) || [];
  const hasNamedDrivers = !!sketch && project.parameters.some((param) =>
    sketch.points.some((p) => [p.x, p.y].some((s) => s.match(/[A-Za-z_]\w*/g)?.includes(param.name))));
  const coordinateOnly = !ranges.length && !drivers.length && !hasNamedDrivers;
  const showCoordinates = (expanded || coordinateOnly) && !!sketch?.points.length;
  useEffect(() => {
    if (!showCoordinates || !sketch || !values) return;
    let active = true;
    solveSketch(sketch, values).then(({ vertices }) => {
      if (active) setSolved({ sketch, vertices });
    }, () => {});
    return () => { active = false; };
  }, [showCoordinates, sketch, values]);
  async function saveSketch(next: Sketch) {
    if (!values || !sketch) return;
    setError("");
    setSaving(true);
    try {
      const result = await solveSketch(next, values);
      if (turned && crossesRevolveAxis(result.points.map((p) => [p.x, p.y]))) throw Error(axisCrossingMessage);
      if (latest.current === project)
        onChange({ ...project, sketches: project.sketches.map((s) => s.id === sketch.id ? next : s) });
    } catch (e) {
      if (latest.current === project) setError((e as Error).message);
    } finally { setSaving(false); }
  }
  function resize(range: ProfileRange, field: "size" | "lower", text: string) {
    if (!sketch || !values) return;
    try { void saveSketch(changeProfileRange(sketch, range, field, text, values)); }
    catch (e) { setError((e as Error).message); }
  }
  function setAmount(amount: string) {
    if (!feature || !values) return;
    try {
      const n = evaluate(amount, values, turned ? "angle" : "length");
      if (Math.abs(n) < 1e-7) throw Error(turned ? "Enter a nonzero revolve angle." : "Enter a nonzero extrusion depth.");
      if (turned && Math.abs(n) > 360) throw Error("Enter a revolve angle of one turn (360°) or less.");
      setError("");
      onChange({ ...project, features: project.features.map((f) => f.id === feature.id ? { ...f, amount } : f) });
    } catch (e) { setError((e as Error).message); }
  }
  if (!sketch && (!feature || feature.kind === "import")) return null;
  const index = Math.min(point, (sketch?.points.length || 1) - 1);
  return <fieldset className="selection-dimensions" disabled={saving || !values} aria-label="Selected geometry dimensions">
    {ranges.map((r) => r.radial ? <div key={r.axis}>
      <Row label="Outside diameter" value={r.size} edit={(s) => resize(r, "size", s)} />
      <Row label={r.hasBore ? "Bore diameter" : "Minimum inside diameter"} value={r.lower} edit={(s) => resize(r, "lower", s)} />
    </div> : <Row key={r.axis} label={r.axis === "y" ? "Profile height" : turned ? "Axial length" : "Profile width"}
      value={r.size} edit={(s) => resize(r, "size", s)} />)}
    {feature && feature.kind !== "import" &&
      <Row label={turned ? "Revolve angle" : "Extrusion depth"} value={feature.amount} edit={setAmount} />}
    {!!ranges.length && <p className="dimension-note">
      {turned ? "Length scales the profile from its left end. Diameters scale the wall between its inner and outer radii."
        : "Resizing scales the outline from its lower-left corner."}
    </p>}
    {sketch && drivers.map((c) => <Row key={c.id} label={driverLabel(c)} value={c.value ?? ""}
      edit={(value) => { void saveSketch({ ...sketch, constraints: sketch.constraints.map((r) => r.id === c.id ? { ...r, value } : r) }); }} />)}
    {!!sketch?.points.length && <div className="profile-coordinates">
      {!coordinateOnly && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Hide point coordinates" : "Edit point coordinates"}
      </button>}
      {showCoordinates && <>
        <label className="dim-field">Profile point<select aria-label="Profile point" value={index}
          onChange={(e) => setPoint(Number(e.target.value))}>
          {sketch.points.map((_, i) => <option key={i} value={i}>P{i + 1}</option>)}
        </select></label>
        {(["x", "y"] as const).map((axis) => {
          const rule = sketch.constraints.find((c) => c.type === axis && c.indices[0] === index);
          const source = sketch.points[index][axis];
          const actual = solved?.sketch === sketch ? solved.vertices[index]?.[axis] : undefined;
          const value = rule?.value ?? (isExpression(source) || actual === undefined ? source : String(Number(actual.toPrecision(15))));
          return <Row key={axis} label={`P${index + 1} ${axis === "y" && turned ? "radius (Y)" : axis.toUpperCase()}`}
            value={value} edit={(text) => {
              let constraints = sketch.constraints;
              if (rule) {
                constraints = constraints.map((c) => c.id === rule.id ? { ...c, value: text } : c);
              } else if (!isExpression(text)) {
                constraints = [...constraints, { id: crypto.randomUUID(), type: axis, indices: [index], value: text }];
              }
              const points = rule ? sketch.points : sketch.points.map((p, i) => i === index ? { ...p, [axis]: text } : p);
              void saveSketch({ ...sketch, points, constraints });
            }} />;
        })}
      </>}
    </div>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </fieldset>;
}
