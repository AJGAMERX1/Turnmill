import { useEffect, useMemo, useRef, useState } from "react";
import InputValue from "./InputValue";
import { evaluate, resolveParameters } from "./expressions";
import { changeProfileRange, profileRange, type ProfileRange } from "./profileSizing";
import { isExpression, solveSketch, type XY } from "./solveSketch";
import { axisCrossingMessage, crossesRevolveAxis } from "./revolveAxis";
import { screwConeProfile, validateProjectScrewCones } from "./screwConeProfile";
import { selectionParameters } from "./selectionParameters";
import { coneSegments, setConeDiameter, type ConeSegment } from "./coneDimensions";
import { bodyOwners, featureUsesSketch } from "./partTabs";
import { evaluateModel } from "./buildModel";
import { prepareRefillSketch, refillComponents } from "./refills";
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

function isCatalogProfile(project: Project, sketchId: string): boolean {
  const catalogIds = new Set(refillComponents(project).map(r => r.bodyId));
  for (const id of Object.keys(project.workspaces?.hardwareComponents ?? {})) catalogIds.add(id);
  function containsProfile(history: Feature[]): boolean {
    // Merging removes a refill from the assembly catalog but retains its original geometry drivers.
    for (const { merge } of history) {
      if (merge?.toolRefill) catalogIds.add(merge.toolRefill.bodyId);
      if (merge?.targetRefill) catalogIds.add(merge.targetRefill.bodyId);
    }
    return history.some(f => (catalogIds.has(f.id) && f.sketchId === sketchId) ||
      (!!f.merge && containsProfile(f.merge.features)));
  }
  return containsProfile(project.features);
}

// Rebuild the affected solids with their cuts and grips before recording an edit.
async function checkConeBuild(project: Project, sketchId: string, signal: AbortSignal) {
  const owners = bodyOwners(project.features);
  const affected = new Set(project.features.filter(f => !f.suppressed && featureUsesSketch(f, sketchId)).map(f => owners.get(f.id)));
  if (!affected.size) return;
  const { features } = await evaluateModel({ ...project, features: project.features.filter(f => affected.has(owners.get(f.id))) });
  if (!features.length || signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const engine = new Worker(new URL("./kernel.ts", import.meta.url), { type: "module", name: "turnmill-cone-edit" });
    const finish = (message?: string) => {
      engine.terminate();
      signal.removeEventListener("abort", cancel);
      if (message) reject(Error(message)); else resolve();
    };
    const cancel = () => finish();
    signal.addEventListener("abort", cancel, { once: true });
    engine.onerror = () => finish("The geometry engine stopped. Try the diameter edit again.");
    engine.onmessage = ({ data }: MessageEvent<{ type: "validated" } | { type: "error"; message: string }>) => {
      if (data.type === "validated") finish();
      if (data.type === "error") finish(data.message);
    };
    try { engine.postMessage({ type: "validate", revision: 1, features }); }
    catch (cause) { finish(cause instanceof Error ? cause.message : "Could not check the diameter. Try again."); }
  });
}

export default function SelectionDimensions({ project, sketch, feature, sketchSelected, turnedProfile, onChange }: {
  project: Project; sketch?: Sketch; feature?: Feature; sketchSelected?: boolean; turnedProfile?: boolean; onChange: (p: Project) => void;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [point, setPoint] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [solved, setSolved] = useState<{ sketch: Sketch; values: Record<string, number>; vertices: XY[] }>();
  const [coneEdge, setConeEdge] = useState<number>();
  const pending = useRef<AbortController | null>(null);
  const latest = useRef(project);
  latest.current = project;
  useEffect(() => () => { pending.current?.abort(); }, []);
  const values = useMemo(() => {
    try { return resolveParameters(project.parameters); } catch { return undefined; }
  }, [project.parameters]);
  const named = useMemo(() => selectionParameters(project,
    sketchSelected && sketch ? { sketch } : feature ? { feature } : sketch ? { sketch } : undefined),
  [project, sketchSelected, sketch, feature]);
  const turned = !!turnedProfile || feature?.kind === "revolve" || (!feature && sketch?.sizing?.y?.radial === true);
  const screwCone = useMemo(() => screwConeProfile(project, sketch, sketchSelected ? undefined : feature), [project, sketch, sketchSelected, feature]);
  const cones = useMemo(() => {
    if (screwCone || !turned || !sketch || !values || isCatalogProfile(project, sketch.id)) return [];
    try { return coneSegments(sketch, values); } catch { return []; }
  }, [screwCone, turned, sketch, values, project.features, project.workspaces]);
  const preferredEdge = coneEdge ?? sketch?.coneEdge?.edge;
  const cone = cones.find(c => c.edge === preferredEdge) ??
    cones.reduce<ConeSegment | undefined>((longest, c) =>
      !longest || c.endX - c.startX > longest.endX - longest.startX ? c : longest, undefined);
  const tipFirst = cone?.tipEnd === "start";
  const vertices = solved && solved.sketch === sketch && solved.values === values ? solved.vertices : undefined;
  const ranges = useMemo(() => {
    if (!sketch || !values || screwCone?.length) return [];
    try {
      const axes = screwCone ? ["x"] as const : ["x", "y"] as const;
      return axes.map((axis) => profileRange(sketch, axis, turned, values, vertices))
        .filter((r): r is ProfileRange => !!r);
    } catch { return []; }
  }, [screwCone, sketch, values, turned, vertices]);
  const drivers = sketch?.constraints.filter((c) => driverLabel(c)) || [];
  const hasNamedDrivers = !!sketch && project.parameters.some((param) =>
    sketch.points.some((p) => [p.x, p.y].some((s) => s.match(/[A-Za-z_]\w*/g)?.includes(param.name))));
  const coordinateOnly = !cones.length && !ranges.length && !drivers.length && !hasNamedDrivers;
  const showCoordinates = (expanded || coordinateOnly) && !!sketch?.points.length;
  const needVertices = showCoordinates || sketch?.constraints.some(c => c.type === "horizontal" || c.type === "vertical");
  useEffect(() => {
    if (!needVertices || !sketch || !values) return;
    let active = true;
    solveSketch(sketch, values).then(({ vertices }) => {
      if (active) setSolved({ sketch, values, vertices });
    }, () => {});
    return () => { active = false; };
  }, [needVertices, sketch, values]);
  async function commitDimensions(candidate: Project, checkSolid = false, nextSketch?: Sketch) {
    setError("");
    setSaving(true);
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    try {
      if (nextSketch && values) {
        if (screwCone) validateProjectScrewCones(candidate, values, project);
        const result = await solveSketch(nextSketch, values);
        if (turned && crossesRevolveAxis(result.points.map((p) => [p.x, p.y]))) throw Error(axisCrossingMessage);
      }
      if (checkSolid && sketch && latest.current === project) await checkConeBuild(candidate, sketch.id, request.signal);
      if (!request.signal.aborted && latest.current === project) {
        if (checkSolid && nextSketch) setConeEdge(nextSketch.coneEdge?.edge);
        onChange(candidate);
      }
    } catch (e) {
      if (!request.signal.aborted && latest.current === project) setError((e as Error).message);
    } finally {
      if (pending.current === request) {
        pending.current = null;
        if (!request.signal.aborted) setSaving(false);
      }
    }
  }
  function saveSketch(next: Sketch, checkSolid = false) {
    if (!sketch || !values) return;
    return commitDimensions({ ...project, sketches: project.sketches.map(s => s.id === sketch.id ? next : s) }, checkSolid, next);
  }
  function resize(range: ProfileRange, field: "size" | "lower", text: string) {
    if (!sketch || !values) return;
    try { void saveSketch(changeProfileRange(sketch, range, field, text, values)); }
    catch (e) { setError((e as Error).message); }
  }
  function resizeCone(segment: ConeSegment, end: "start" | "end", expression: string) {
    if (!sketch || !values) return;
    try { void saveSketch(setConeDiameter(sketch, segment, end, expression, values), true); }
    catch (cause) { setError((cause as Error).message); }
  }
  function editParameter(name: string, expression: string) {
    try {
      const parameters = project.parameters.map(p => p.name === name ? { ...p, expression } : p);
      const next = { ...project, parameters };
      const resolved = resolveParameters(parameters);
      validateProjectScrewCones(next, resolved, project);
      if (sketch) {
        const root = project.features.find(f => f.operation === "new" && f.sketchId === sketch.id);
        if (root) prepareRefillSketch(next, root.id, sketch, resolved);
      }
      if (screwCone) void commitDimensions(next, true);
      else {
        setError("");
        onChange(next);
      }
    } catch (cause) { setError((cause as Error).message); }
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
  if (!named.length && !sketch && (!feature || feature.kind === "import" || feature.kind === "merge")) return null;
  const index = Math.min(point, (sketch?.points.length || 1) - 1);
  const coneLabels = new Map<string | undefined, string>(screwCone ? [
    [screwCone.opening, "Bore diameter"], [screwCone.tip, "Tip outside diameter"],
    [screwCone.base, "Cone base diameter"], [screwCone.length, "Cone length"],
  ] : []);
  const primary = screwCone
    ? [...coneLabels.keys()].flatMap(name => named.filter(p => p.name === name))
    : named.slice(0, 5);
  const more = screwCone ? named.filter(p => !coneLabels.has(p.name)) : named.slice(5);
  const parameterRow = (p: typeof named[number]) =>
    <Row key={p.name} label={coneLabels.get(p.name) ?? p.label} value={p.expression} edit={text => editParameter(p.name, text)} />;
  return <fieldset className="selection-dimensions" disabled={saving} aria-label="Selected geometry dimensions">
    {primary.map(parameterRow)}
    {screwCone && sketch && values && (["tip", "base"] as const).map(end => {
      if (screwCone[end]) return null;
      // Older sketches can have a directly edited outside radius at either end.
      const i = end === "tip" ? 2 : 1;
      const radius = sketch.points[i].y;
      return <Row key={end} label={end === "tip" ? "Tip outside diameter" : "Cone base diameter"}
        value={`(${radius}) * 2`} edit={text => {
          const points = sketch.points.map((p, index) => index === i ? { ...p, y: `(${text}) / 2` } : p);
          void saveSketch({ ...sketch, points }, true);
        }} />;
    })}
    {screwCone && <p className="dimension-note">Bore diameter sets the hole for the refill.</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    {saving && (screwCone || cone) && <p role="status" className="dimension-note">Checking the solid…</p>}
    {more.length > 0 && <details className="additional-dimensions">
      <summary>More dimensions ({more.length})</summary>{more.map(parameterRow)}
    </details>}
    {cone && <>
      {cones.length > 1 && <label className="dim-field">Taper<select aria-label="Taper" value={cone.edge}
        onChange={e => { setConeEdge(Number(e.target.value)); setError(""); }}>
        {cones.map(c => <option key={c.edge} value={c.edge}>X {Number(c.startX.toFixed(3))} to {Number(c.endX.toFixed(3))} mm</option>)}
      </select></label>}
      <Row label="Tip outside diameter" value={tipFirst ? cone.startDiameter : cone.endDiameter}
        edit={s => resizeCone(cone, tipFirst ? "start" : "end", s)} />
      <Row label="Base outside diameter" value={tipFirst ? cone.endDiameter : cone.startDiameter}
        edit={s => resizeCone(cone, tipFirst ? "end" : "start", s)} />
    </>}
    {ranges.map((r) => r.radial ? <div key={r.axis}>
      {cones.length !== 1 && <Row label="Outside diameter" value={r.size} edit={(s) => resize(r, "size", s)} />}
      <Row label={r.hasBore ? "Bore diameter" : "Minimum inside diameter"} value={r.lower} edit={(s) => resize(r, "lower", s)} />
    </div> : <Row key={r.axis} label={r.axis === "y" ? "Profile height" : turned ? "Axial length" : "Profile width"}
      value={r.size} edit={(s) => resize(r, "size", s)} />)}
    {feature && feature.kind !== "import" && feature.kind !== "merge" &&
      <Row label={turned ? "Revolve angle" : "Extrusion depth"} value={feature.amount} edit={setAmount} />}
    {!!ranges.length && <p className="dimension-note">
      {cone ? "Tip and base set the outside diameters at the two ends of the taper."
        : turned ? "Length scales the profile from its left end. Diameters scale the wall between its inner and outer radii."
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
          const actual = vertices?.[index]?.[axis];
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
  </fieldset>;
}
