import type { Advanced } from "./advancedTypes";
import type { Finish } from "./finishingTypes";
import { partFeatures } from "./partTabs";
import { dimensionLabels, refillCatalog, refillComponents, refillDimensionLabel, type RefillDimension } from "./refills";
import type { Feature, Project, Sketch } from "./types";

type Selection = { sketch: Sketch } | { feature: Feature };
type DimensionRow = { name: string; label: string; expression: string };

function finishExpressions(f: Finish): (string | undefined)[] {
  switch (f.kind) {
    case "fillet":
    case "chamfer": return [f.size];
    case "thread": return [f.diameter, f.pitch, f.length, f.backWall];
    case "mark": return [f.height, f.depth, f.offset, f.rotation];
    case "grip": return [f.length, f.width, f.depth, f.offset, f.count];
    case "knurl": return [f.diameter, f.length, f.depth, f.offset, f.count, f.style === "diamond" ? f.angle : undefined];
    case "hole": return [
      f.diameter, f.termination === "through" ? undefined : f.length, f.offsetU, f.offsetV,
      f.profile === "counterbore" || f.profile === "countersink" ? f.seatDiameter : undefined,
      f.profile === "counterbore" ? f.seatDepth : undefined,
      f.profile === "countersink" ? f.seatAngle : undefined,
    ];
    default: return [];
  }
}

/** Return the named dimensions driving this selection. The full parameter table retains all project inputs. */
export function selectionParameters(project: Project, selection?: Selection): DimensionRow[] {
  if (!selection || !project.parameters.length) return [];
  const names = new Set<string>();
  const sketches = new Map(project.sketches.map(s => [s.id, s]));
  const visited = new Set<string>();

  function read(...expressions: (string | undefined)[]) {
    for (const expression of expressions) {
      if (typeof expression !== "string" || !expression) continue;
      // Consume numbers, including their exponents, before recognizing parameter tokens.
      for (const [, name] of expression.matchAll(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|([A-Za-z_]\w*)/g)) {
        if (name) names.add(name);
      }
    }
  }

  function readSketch(s?: Sketch) {
    if (!s || visited.has(s.id)) return;
    visited.add(s.id);
    for (const axis of ["x", "y"] as const) {
      const coordinates = s.points.map(p => p[axis]);
      for (const rule of s.constraints) {
        if (rule.type === axis && rule.value) coordinates[rule.indices[0]] = rule.value;
      }
      for (const coordinate of coordinates) read(coordinate);
      const range = s.sizing?.[axis];
      if (range && range.coordinates?.length === coordinates.length &&
          coordinates.every((value, i) => value === range.coordinates[i])) read(range.lower, range.size);
    }
    for (const rule of s.constraints) {
      if (["arc", "length", "distance", "angle"].includes(rule.type)) read(rule.value);
    }
  }

  function readOperation(op: Advanced) {
    switch (op.kind) {
      case "shell": read(op.thickness); break;
      case "mirror": read(op.offset); break;
      case "linearPattern": read(op.count, op.spacing); break;
      case "circularPattern": read(op.count, op.stepAngle); break;
      case "sweep":
        read(op.anchorX, op.anchorY, op.z);
        readSketch(sketches.get(op.sectionId));
        readSketch(sketches.get(op.pathId));
        break;
      case "loft":
        read(op.z1, op.z2);
        readSketch(sketches.get(op.lowerId));
        readSketch(sketches.get(op.upperId));
        break;
    }
  }

  function readFeature(f: Feature) {
    if (f.kind === "revolve" || f.kind === "extrude") {
      readSketch(sketches.get(f.sketchId));
      read(f.amount);
    }
    for (const finish of f.finishes ?? []) {
      if (!finish.suppressed) read(...finishExpressions(finish));
    }
    if (f.operations) {
      for (const entry of f.operations) if (!entry.suppressed) readOperation(entry.operation);
    } else if (f.advanced) readOperation(f.advanced);
    for (const source of f.merge?.features ?? []) if (!source.suppressed) readFeature(source);
  }

  let selectedRoot: Feature | undefined;
  const sketchOnly = "sketch" in selection;
  if ("sketch" in selection) {
    const sketch = selection.sketch;
    readSketch(sketch);
    const roots = project.features.filter(f => f.operation === "new" && f.sketchId === sketch.id);
    selectedRoot = roots.find(root => root.id === sketch.partId) ?? (roots.length === 1 ? roots[0] : undefined);
  } else {
    const f = selection.feature;
    if (f.operation === "new") selectedRoot = f;
    if (f.kind === "merge" && f.bodyId) {
      for (const upstream of partFeatures(project, f.bodyId)) {
        if (upstream.id === f.id) break;
        if (!upstream.suppressed) readFeature(upstream);
      }
    }
    readFeature(f);
  }

  const parameters = new Map(project.parameters.map(p => [p.name, p]));
  const rows = new Map<string, DimensionRow>();
  function add(name: string, label?: string) {
    const p = parameters.get(name);
    if (p && !rows.has(name)) rows.set(name, { name, label: label || p.label || name.replaceAll("_", " "), expression: p.expression });
  }

  // Catalog dimensions use their own order and labels. A refill's generated
  // tail aliases and other construction parameters stay in the full table.
  if (selectedRoot) {
    const refill = refillComponents(project).find(item => item.bodyId === selectedRoot.id);
    if (refill) {
      for (const key of Object.keys(refillCatalog[refill.kind].fields) as RefillDimension[]) {
        const name = refill.prefix + "_" + key;
        if (!sketchOnly || names.has(name)) add(name, refillDimensionLabel(refill.kind, key));
      }
      for (const key of Object.keys(dimensionLabels)) names.delete(refill.prefix + "_" + key);
    } else {
      const fields = project.workspaces?.hardwareComponents?.[selectedRoot.id]?.dimensions;
      if (Array.isArray(fields)) {
        for (const field of fields) {
          if (typeof field?.parameter === "string" && (!sketchOnly || names.has(field.parameter)))
            add(field.parameter, typeof field.label === "string" ? field.label : undefined);
        }
      }
    }
  }
  for (const p of project.parameters) if (names.has(p.name)) add(p.name);
  return [...rows.values()];
}
