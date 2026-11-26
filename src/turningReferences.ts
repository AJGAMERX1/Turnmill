import { evaluate } from "./expressions";
import { partFeatures } from "./partTabs";
import type { Project } from "./types";

type MeasuredRim = { axis: "X" | "Z"; station: number; outside: number };
type References = { station?: string; diameter?: string };
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6;

/** Retain a proven driver from the source turning when the measured end still matches its planar rim. */
export function turningReferences(project: Project, bodyId: string, stock: MeasuredRim,
  end: "start" | "end", values: Record<string, number>, atSeat?: number): References {
  if (stock.axis !== "X") return {};
  const history = partFeatures(project, bodyId).filter(f => !f.suppressed);
  const root = history[0];
  if (root?.kind !== "revolve" || root.id !== bodyId || history.some(f => f.operation === "add" ||
      f.advanced || f.operations?.some(step => !step.suppressed))) return {};
  const sketch = project.sketches.find(s => s.id === root.sketchId);
  if (!sketch || sketch.points.length < 3) return {};
  const sources = sketch.points.map(p => ({ ...p }));
  try {
    if (!near(Math.abs(evaluate(root.amount, values, "angle")), 360)) return {};
    for (const c of sketch.constraints) {
      const i = c.indices[0];
      if (!sources[i] || c.indices.length !== 1) return {};
      if (c.type === "x" || c.type === "y") {
        if (!c.value) return {};
        sources[i][c.type] = c.value;
      } else if (c.type !== "horizontal" && c.type !== "vertical") return {};
    }
    const vertices = sources.map(p => ({ x: evaluate(p.x, values), y: evaluate(p.y, values) }));
    for (const c of sketch.constraints) {
      if (c.type !== "horizontal" && c.type !== "vertical") continue;
      const i = c.indices[0], j = (i + 1) % vertices.length, axis = c.type === "vertical" ? "x" : "y";
      if (!near(vertices[i][axis], vertices[j][axis])) return {};
    }
    const xs = vertices.map(p => p.x);
    const extreme = end === "start" ? Math.min(...xs) : Math.max(...xs);
    if (!near(stock.station, extreme)) return {};
    const rim = vertices.map((p, i) => ({ ...p, source: sources[i] })).filter(p => near(p.x, extreme));
    // A single extremal vertex is an apex or knife edge, not a planar end face.
    if (rim.length < 2 || !near(Math.max(...rim.map(p => 2 * Math.abs(p.y))), stock.outside)) return {};
    const outside = rim.filter(p => near(2 * Math.abs(p.y), stock.outside));

    // Equal values alone cannot identify a driver: independent parameters may
    // happen to coincide today. Coordinates on the same rim must agree in source.
    function sharedDriver(expressions: string[]) {
      const first = expressions[0];
      if (!first || expressions.some(s => s.replace(/\s+/g, "") !== first.replace(/\s+/g, ""))) return;
      try { evaluate(first, {}); }
      catch { return "(" + first + ")"; }
    }
    const station = sharedDriver(rim.map(p => p.source.x));
    let radius = sharedDriver(outside.map(p => p.source.y));
    if (radius && atSeat !== undefined) {
      // A taper with independently driven endpoints can happen to be cylindrical today.
      // Only propagate a driver that also controls both radii along the actual seating edge.
      const sharedAlongSeat = vertices.some((p, i) => {
        const j = (i + 1) % vertices.length, q = vertices[j];
        return !near(p.x, q.x) && Math.min(p.x,q.x) <= atSeat && Math.max(p.x,q.x) >= atSeat &&
          near(p.y,q.y) && near(2 * Math.abs(p.y), stock.outside) &&
          sharedDriver([sources[i].y, sources[j].y]) === radius;
      });
      if (!sharedAlongSeat) radius = undefined;
    }
    return {
      ...(station && { station }),
      ...(radius && { diameter: radius + (outside[0].y < 0 ? " * -2" : " * 2") }),
    };
  } catch { return {}; }
}
