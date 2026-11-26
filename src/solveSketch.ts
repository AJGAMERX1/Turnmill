import {
  GcsWrapper,
  init_planegcs_module,
  type SketchPrimitive,
} from "@salusoft89/planegcs";
import solverUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";
import { evaluate, isExpression } from "./expressions";
import { validateProfileSizing } from "./profileSizing";
import type { Constraint, Point, Sketch } from "./types";

export type XY = { x: number; y: number };
export type SolvedEdge = { start: XY; end: XY; through?: XY };
export type SketchSolution = {
  points: XY[];
  vertices: XY[];
  edges: SolvedEdge[];
  edgePaths: XY[][];
  dof: number;
  redundant: string[];
};
let engine: ReturnType<typeof init_planegcs_module> | undefined;

export { isExpression } from "./expressions";

export const ruleNames: Record<string, string> = {
  symmetricX: "Symmetric about X axis",
  symmetricY: "Symmetric about Y axis",
  horizontal: "Horizontal",
  vertical: "Vertical",
  parallel: "Parallel edges",
  equal: "Equal lengths",
  symmetric: "Symmetric about edge",
  coincident: "Coincident points",
  distance: "Point distance",
  length: "Edge length",
  tangent: "Tangent",
  arc: "Arc radius",
  x: "Fix X coordinate",
  y: "Fix Y coordinate",
};
const pointId = (i: number) => "vertex" + i;
const edgeId = (i: number) => "edge" + i;
const centerId = (i: number) => "center" + i;
const distance = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

export function coordinateSeeds(
  points: Point[],
  parameters: Record<string, number>,
): XY[] {
  return points.map((p, i) => {
    try {
      const x = evaluate(p.x, parameters),
        y = evaluate(p.y, parameters);
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error("Enter a finite length.");
      return { x, y };
    } catch (e) {
      throw new Error(
        "P" +
          (i + 1) +
          " — " +
          (e instanceof Error ? e.message : "Check its coordinates."),
      );
    }
  });
}

function arcCenter(start: XY, end: XY, signedRadius: number) {
  const chord = distance(start, end),
    radius = Math.abs(signedRadius);
  if (chord < 1e-8) throw new Error("An arc needs two distinct endpoints.");
  if (radius + 1e-8 < chord / 2 || !radius) {
    throw new Error(
      "Arc radius must be at least " +
        (chord / 2).toFixed(3) +
        " mm for these endpoints.",
    );
  }
  const offset =
    (Math.sign(signedRadius) *
      Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4))) /
    chord;
  return {
    x: (start.x + end.x) / 2 + (end.y - start.y) * offset,
    y: (start.y + end.y) / 2 - (end.x - start.x) * offset,
  };
}

function describe(rule: Constraint) {
  return ruleNames[rule.type] || rule.type;
}

/** Coordinate expressions drive their axis. Plain numeric coordinates seed free variables. */
export async function solveSketch(
  sketch: Sketch,
  parameters: Record<string, number>,
): Promise<SketchSolution> {
  validateProfileSizing(sketch, parameters);
  const seeds = coordinateSeeds(sketch.points, parameters),
    n = seeds.length;
  if (n < 3) throw new Error("A closed profile needs at least three vertices.");
  const next = (i: number) => (i + 1) % n;
  const geometries: SketchPrimitive[] = [];
  const relations: SketchPrimitive[] = [];
  const labels = new Map<string, string>();
  const arcs = new Map<number, { radius: number; id: string }>();
  const knownIds = new Set<string>();
  function relation(p: SketchPrimitive, label: string) {
    relations.push(p);
    labels.set(p.id, label);
  }

  for (let i = 0; i < n; i++) {
    geometries.push({
      type: "point",
      id: pointId(i),
      ...seeds[i],
      fixed: false,
    });
    for (const axis of ["x", "y"] as const) {
      if (isExpression(sketch.points[i][axis])) {
        const id = "expr-" + i + axis,
          p_id = pointId(i);
        relation(
          axis === "x"
            ? { id, type: "coordinate_x", p_id, x: seeds[i].x }
            : { id, type: "coordinate_y", p_id, y: seeds[i].y },
          "P" + (i + 1) + " " + axis.toUpperCase() + " expression",
        );
      }
    }
  }
  for (let i = 0; i < n; i++) {
    geometries.push({
      type: "line",
      id: edgeId(i),
      p1_id: pointId(i),
      p2_id: pointId(next(i)),
    });
  }
  const useX = sketch.constraints.some((c) => c.type === "symmetricX");
  const useY = sketch.constraints.some((c) => c.type === "symmetricY");
  if (useX || useY)
    geometries.push({ type: "point", id: "origin", x: 0, y: 0, fixed: true });
  if (useX)
    geometries.push(
      { type: "point", id: "axis-x", x: 1, y: 0, fixed: true },
      { type: "line", id: "reference-x", p1_id: "origin", p2_id: "axis-x" },
    );
  if (useY)
    geometries.push(
      { type: "point", id: "axis-y", x: 0, y: 1, fixed: true },
      { type: "line", id: "reference-y", p1_id: "origin", p2_id: "axis-y" },
    );
  for (const rule of sketch.constraints) {
    if (knownIds.has(rule.id))
      throw new Error("Two constraints share the same identifier.");
    knownIds.add(rule.id);
    if (rule.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= n))
      throw new Error(describe(rule) + " refers to a missing vertex or edge.");
    if (rule.type !== "arc") continue;
    const [i] = rule.indices;
    if (rule.indices.length !== 1 || arcs.has(i))
      throw new Error("Each edge can have one arc radius.");
    const radius = evaluate(rule.value || "", parameters);
    const center = arcCenter(seeds[i], seeds[next(i)], radius);
    arcs.set(i, { radius, id: rule.id });
    geometries.push({
      type: "point",
      id: centerId(i),
      ...center,
      fixed: false,
    });
    for (const end of [i, next(i)]) {
      geometries.push({
        type: "line",
        id: "radial" + i + "-" + end,
        p1_id: centerId(i),
        p2_id: pointId(end),
      });
      relation(
        {
          id: "radius" + i + "-" + end,
          type: "p2p_distance",
          p1_id: centerId(i),
          p2_id: pointId(end),
          distance: Math.abs(radius),
        },
        "E" + (i + 1) + " radius",
      );
    }
  }
  for (const rule of sketch.constraints) {
    if (rule.type === "arc") continue;
    const [a, b, c] = rule.indices,
      id = "constraint" + rule.id;
    const arity: Record<string, number> = {
      x: 1,
      y: 1,
      horizontal: 1,
      vertical: 1,
      length: 1,
      parallel: 2,
      equal: 2,
      tangent: 2,
      coincident: 2,
      distance: 2,
      symmetric: 3,
      symmetricX: 2,
      symmetricY: 2,
    };
    if (!arity[rule.type] || rule.indices.length !== arity[rule.type])
      throw new Error("Invalid " + describe(rule) + " constraint.");
    if (a === b && b !== undefined)
      throw new Error(describe(rule) + " requires two distinct selections.");
    const p1_id = pointId(a),
      p2_id = pointId(b),
      l1_id = edgeId(a),
      l2_id = edgeId(b);
    const straight = ["horizontal", "vertical", "length", "parallel", "equal"];
    if (
      straight.includes(rule.type) &&
      (arcs.has(a) ||
        ((rule.type === "parallel" || rule.type === "equal") && arcs.has(b)))
    )
      throw new Error(describe(rule) + " requires straight edges.");
    let primitive: SketchPrimitive;
    switch (rule.type) {
      case "x":
        primitive = {
          id,
          type: "coordinate_x",
          p_id: p1_id,
          x: rule.value ? evaluate(rule.value, parameters) : seeds[a].x,
        };
        break;
      case "y":
        primitive = {
          id,
          type: "coordinate_y",
          p_id: p1_id,
          y: rule.value ? evaluate(rule.value, parameters) : seeds[a].y,
        };
        break;
      case "horizontal":
        primitive = { id, type: "horizontal_l", l_id: l1_id };
        break;
      case "vertical":
        primitive = { id, type: "vertical_l", l_id: l1_id };
        break;
      case "parallel":
        primitive = { id, type: "parallel", l1_id, l2_id };
        break;
      case "equal":
        primitive = { id, type: "equal_length", l1_id, l2_id };
        break;
      case "coincident":
        primitive = { id, type: "p2p_coincident", p1_id, p2_id };
        break;
      case "length":
      case "distance": {
        const length = evaluate(rule.value || "", parameters);
        if (length <= 0) throw new Error("A length must be greater than zero.");
        primitive = {
          id,
          type: "p2p_distance",
          p1_id,
          p2_id: rule.type === "length" ? pointId(next(a)) : p2_id,
          distance: length,
        };
        break;
      }
      case "symmetricX":
      case "symmetricY":
        primitive = {
          id,
          type: "p2p_symmetric_ppl",
          p1_id,
          p2_id,
          l_id: rule.type === "symmetricX" ? "reference-x" : "reference-y",
        };
        break;
      case "symmetric":
        if ([a, b].some((i) => i === c || i === next(c)))
          throw new Error(
            "Choose a symmetry axis edge separate from the two points, or use a sketch axis.",
          );
        if (arcs.has(c))
          throw new Error("Select a straight edge for the symmetry axis.");
        primitive = {
          id,
          type: "p2p_symmetric_ppl",
          p1_id,
          p2_id,
          l_id: edgeId(c),
        };
        break;
      case "tangent": {
        const arc = arcs.has(a) ? a : b,
          line = arc === a ? b : a;
        if (!arcs.has(arc) || arcs.has(line))
          throw new Error(
            "Select one arc and one adjacent straight edge for tangency.",
          );
        const common = [arc, next(arc)].find(
          (i) => i === line || i === next(line),
        );
        if (common === undefined)
          throw new Error("Tangent edges must share an endpoint.");
        primitive = {
          id,
          type: "perpendicular_ll",
          l1_id: edgeId(line),
          l2_id: "radial" + arc + "-" + common,
        };
        break;
      }
      default:
        throw new Error("Unsupported constraint " + rule.type);
    }
    relation(
      primitive,
      describe(rule) + " (" + rule.indices.map((i) => i + 1).join(", ") + ")",
    );
  }
  if (!relations.length)
    return {
      points: seeds,
      vertices: seeds,
      edges: seeds.map((start, i) => ({ start, end: seeds[next(i)] })),
      edgePaths: seeds.map((p, i) => [p, seeds[next(i)]]),
      dof: 2 * n,
      redundant: [],
    };

  engine ??= init_planegcs_module({ locateFile: () => solverUrl }).catch(
    (e: unknown) => {
      engine = undefined;
      throw e;
    },
  );
  const module = await engine;
  const solver = new GcsWrapper(new module.GcsSystem(), module);
  try {
    solver.push_primitives_and_params([...geometries, ...relations]);
    const status = solver.solve();
    const conflicts = solver
      .get_gcs_conflicting_constraints()
      .map((id) => labels.get(id) || id);
    if (status > 1 || conflicts.length) {
      throw new Error(
        conflicts.length
          ? "Conflicting dimensions or constraints — " +
            [...new Set(conflicts)].join(", ") +
            "."
          : "The sketch cannot satisfy these constraints. Adjust a dimension or remove a constraint.",
      );
    }
    solver.apply_solution();
    function getPoint(id: string) {
      const p = solver.sketch_index.get_sketch_point(id);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
        throw new Error("The sketch solver returned an invalid coordinate.");
      return {
        x: Math.abs(p.x) < 1e-9 ? 0 : p.x,
        y: Math.abs(p.y) < 1e-9 ? 0 : p.y,
      };
    }
    const vertices = seeds.map((_, i) => getPoint(pointId(i))),
      points: XY[] = [],
      edges: SolvedEdge[] = [];
    const edgePaths: XY[][] = [];
    const collapsed = new Set(
      sketch.constraints
        .filter((c) => c.type === "coincident")
        .map((c) => [...c.indices].sort((a, b) => a - b).join(",")),
    );
    vertices.forEach((start, i) => {
      const end = vertices[next(i)],
        arc = arcs.get(i),
        edge: SolvedEdge = { start, end };
      const samples = [start];
      edgePaths.push(samples);
      if (
        !arc &&
        distance(start, end) < 1e-7 &&
        collapsed.has([i, next(i)].sort((a, b) => a - b).join(","))
      ) {
        samples.push(end);
        return;
      }
      edges.push(edge);
      points.push(start);
      if (!arc) {
        samples.push(end);
        return;
      }
      const center = getPoint(centerId(i)),
        r = Math.abs(arc.radius);
      const theta = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
      const direction = -Math.sign(arc.radius),
        full = Math.PI * 2;
      const sweep = (((direction * (endAngle - theta)) % full) + full) % full;
      const arcPoint = (t: number): XY => ({
        x: center.x + r * Math.cos(theta + t * direction * sweep),
        y: center.y + r * Math.sin(theta + t * direction * sweep),
      });
      edge.through = arcPoint(0.5);
      const steps = Math.min(
        1024,
        Math.max(
          2,
          Math.ceil(
            sweep /
              Math.max(
                0.00001,
                Math.min(
                  Math.PI / 16,
                  2 * Math.acos(Math.max(-1, 1 - 0.002 / r)),
                ),
              ),
          ),
        ),
      );
      for (let j = 1; j < steps; j++) {
        const sample = arcPoint(j / steps);
        points.push(sample);
        samples.push(sample);
      }
      samples.push(end);
    });
    const redundant = [
      ...solver.get_gcs_redundant_constraints(),
      ...solver.get_gcs_partially_redundant_constraints(),
    ].map((id) => labels.get(id) || id);
    return {
      points,
      vertices,
      edges,
      edgePaths,
      dof: Math.max(0, solver.gcs.dof()),
      redundant: [...new Set(redundant)],
    };
  } finally {
    solver.destroy_gcs_module();
  }
}
