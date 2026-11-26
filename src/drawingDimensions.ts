import { evaluate } from "./expressions";
import type { ProjectedView } from "./secondaryProjection";
import { label, line, n, path, type Mark, type XY } from "./secondaryVector";
import type { EvaluatedFeature, Project } from "./types";

export const orthographic = ["front", "top", "right"] as const;
export const dimensionViewNames = [...orthographic, "section"] as const;
type OrthographicView = (typeof orthographic)[number];
export type DimensionView = (typeof dimensionViewNames)[number];
export type DimensionGeometry = Record<OrthographicView, ProjectedView> & {
  section?: ProjectedView;
};
export type DimensionMode = "horizontal" | "vertical" | "aligned";
export type FinishedDimension = {
  id: string;
  view: DimensionView;
  a: string;
  b: string;
  mode: DimensionMode;
  offset: string;
  tolerance: "general" | "symmetric" | "bilateral";
  plus: string;
  minus: string;
};
export type Snap = {
  key: string;
  aliases: string[];
  xy: XY;
  name: string;
  kind: "vertex" | "center";
};
export type MeasuredDimension = {
  spec: FinishedDimension;
  a: XY;
  b: XY;
  value: number;
  text: string;
  offset: number;
};
export const viewName = (view: DimensionView) =>
  ({ front: "Front", top: "Top", right: "Right", section: "Section A–A" })[
    view
  ];
export const dimensionSheetName = (view: DimensionView) =>
  viewName(view) + " dimensions";
const pointKey = (p: XY) => p.map((v) => n(v, 6)).join(",");
const epsilon = 1e-6;
const close = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= epsilon;

// Only actual visible HLR endpoints and analytic curve centers are pickable.
// A semantic name is attached only when it coincides with that exact projected landmark.
export function dimensionSnaps(
  view: OrthographicView,
  drawing: ProjectedView,
  features: EvaluatedFeature[],
  project: Project,
  useBodyReferences = true,
): Snap[] {
  const map = new Map<string, Snap>();
  const buckets = new Map<string, Snap[]>();
  const grid = (p: XY) => p.map((v) => Math.round(v / epsilon));
  function add(p: XY, kind: Snap["kind"]) {
    const [i, j] = grid(p);
    const nearby: Snap[] = [];
    for (let u = i - 1; u <= i + 1; u++)
      for (let v = j - 1; v <= j + 1; v++)
        nearby.push(...(buckets.get(u + "," + v) || []));
    if (nearby.some((s) => s.kind === kind && close(s.xy, p))) return;
    const key = kind + ":" + pointKey(p);
    const s: Snap = {
      xy: p,
      key,
      aliases: [key],
      kind,
      name: kind === "vertex" ? "Edge endpoint" : "Curve center",
    };
    map.set(key, s);
    const k = i + "," + j;
    buckets.set(k, [...(buckets.get(k) || []), s]);
  }
  for (const pts of drawing.paths)
    if (pts.length >= 2 && !close(pts[0], pts[pts.length - 1])) {
      add(pts[0], "vertex");
      add(pts[pts.length - 1], "vertex");
    }
  for (const p of drawing.centers || []) add(p, "center");
  function identify(p: XY, kind: Snap["kind"], id: string, name: string) {
    const [i, j] = grid(p);
    for (let u = i - 1; u <= i + 1; u++)
      for (let v = j - 1; v <= j + 1; v++)
        for (const s of buckets.get(u + "," + v) || []) {
          if (s.kind !== kind || !close(s.xy, p) || s.aliases.includes(id))
            continue;
          if (s.aliases.length === 1) {
            s.key = id;
            s.name = name;
          }
          s.aliases.push(id);
        }
  }
  const sorted = () =>
    [...map.values()].sort(
      (a, b) =>
        a.xy[0] - b.xy[0] || a.xy[1] - b.xy[1] || a.kind.localeCompare(b.kind),
    );
  // Assembly coordinates are already transformed into the assembled home pose.
  if (!useBodyReferences) return sorted();
  const [lo, hi] = drawing.bounds;
  for (const x of [0, 1])
    for (const y of [0, 1]) {
      identify(
        [x ? hi[0] : lo[0], y ? hi[1] : lo[1]],
        "vertex",
        `extent:${x}:${y}`,
        (y ? "Upper " : "Lower ") + (x ? "right" : "left") + " corner",
      );
    }
  const reversedLength = features.at(-1)?.reverseRefillLength;
  const projectPoint = (x: number, y: number, z: number): XY => {
    if (reversedLength !== undefined) {
      x = reversedLength - x;
      y = -y;
    }
    return view === "front" ? [x, z] : view === "top" ? [x, y] : [y, z];
  };
  for (const feature of features) {
    const raw = project.features.find((f) => f.id === feature.id);
    const sketch = project.sketches.find((s) => s.id === raw?.sketchId);
    if (
      !sketch ||
      !feature.edges ||
      feature.edges.length !== sketch.points.length
    )
      continue;
    for (const [i, edge] of feature.edges.entries()) {
      const { x, y } = edge.start,
        p = sketch.points[i];
      const id = JSON.stringify([feature.id, sketch.id, p.x, p.y]);
      const note = feature.name + " · profile point " + (i + 1);
      if (feature.kind === "extrude") {
        identify(projectPoint(x, y, 0), "vertex", id + ":base", note);
        identify(
          projectPoint(x, y, feature.amount),
          "vertex",
          id + ":end",
          note,
        );
      } else if (
        feature.kind === "revolve" &&
        Math.abs(Math.abs(feature.amount) - 360) < 1e-7
      ) {
        const r = Math.abs(y);
        for (const [suffix, dy, dz] of [
          ["y+", r, 0],
          ["y-", -r, 0],
          ["z+", 0, r],
          ["z-", 0, -r],
        ] as const)
          identify(projectPoint(x, dy, dz), "vertex", id + ":" + suffix, note);
      }
    }
    // In an unchanged new stock footprint, M2's drill datum is exactly the
    // turning axis or the center of the extrusion's XY bounds.
    if (
      feature.operation === "new" &&
      !feature.edges.some((e) => e.through) &&
      ((feature.kind === "revolve" && view === "right") ||
        (feature.kind === "extrude" && view === "top"))
    ) {
      const pts = feature.edges.map((e) => e.start);
      let midX = 0,
        midY = 0;
      if (feature.kind === "extrude") {
        let xmin = Infinity,
          ymin = Infinity,
          xmax = -Infinity,
          ymax = -Infinity;
        for (const p of pts) {
          xmin = Math.min(xmin, p.x);
          ymin = Math.min(ymin, p.y);
          xmax = Math.max(xmax, p.x);
          ymax = Math.max(ymax, p.y);
        }
        midX = (xmin + xmax) / 2;
        midY = (ymin + ymax) / 2;
      }
      for (const op of feature.finishes || []) {
        if (op.suppressed) continue;
        if (op.kind !== "hole") break;
        const u = midX + (op.offsetU ?? 0), v = midY + (op.offsetV ?? 0);
        identify(
          feature.kind === "revolve" ? projectPoint(0, u, v) : projectPoint(u, v, 0),
          "center",
          JSON.stringify([feature.id, op.id, "hole-center"]),
          op.name + " center",
        );
      }
    }
  }
  return sorted();
}
export function findSnap(snaps: Snap[], ref: string): Snap | undefined {
  return snaps.find((s) => s.aliases.includes(ref));
}
// Intentional tolerance limits retain significant digits independently of the model's display precision.
export const formatTolerance = (value: number) =>
  Number(value.toPrecision(12)).toString();
export function formatDrawingLength(value: number) {
  if (value === 0) return "0";
  return Math.abs(value) < 1e-6
    ? Number(value.toPrecision(4)).toString()
    : n(value, 6);
}
export function measureDimension(
  spec: FinishedDimension,
  snaps: Snap[],
  values: Record<string, number>,
): MeasuredDimension {
  const a = findSnap(snaps, spec.a)?.xy,
    b = findSnap(snaps, spec.b)?.xy;
  if (!a || !b)
    throw Error(
      "An endpoint of this dimension is missing. Edit the dimension and pick its replacement.",
    );
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const value =
    spec.mode === "horizontal"
      ? Math.abs(dx)
      : spec.mode === "vertical"
        ? Math.abs(dy)
        : spec.mode === "aligned"
          ? Math.hypot(dx, dy)
          : NaN;
  if (!(value > epsilon))
    throw Error(
      "The points coincide in this direction. Choose another direction or endpoint.",
    );
  let text = formatDrawingLength(value);
  if (spec.tolerance !== "general") {
    const plus = evaluate(spec.plus, values),
      minus =
        spec.tolerance === "symmetric" ? plus : evaluate(spec.minus, values);
    if (plus < 0 || minus < 0)
      throw Error("Enter tolerance allowances of zero or more.");
    text +=
      spec.tolerance === "symmetric"
        ? " ±" + formatTolerance(plus)
        : " +" + formatTolerance(plus) + "/−" + formatTolerance(minus);
  }
  return { spec, a, b, value, text, offset: evaluate(spec.offset, values) };
}
export function dimensionLayout(
  view: ProjectedView,
  scaleChoice: "auto" | number,
) {
  const [[x0, y0], [x1, y1]] = view.bounds,
    w = x1 - x0,
    h = y1 - y0;
  const room = Math.min(219 / (w || 1), 98 / (h || 1));
  const scales = [
    100, 50, 20, 10, 5, 4, 2, 1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.01, 0.005,
    0.001,
  ];
  const scale =
    scaleChoice === "auto"
      ? (scales.find((s) => s <= room + 1e-9) ?? room)
      : scaleChoice;
  const at = ([x, y]: XY): XY => [
    148.5 + (x - (x0 + x1) / 2) * scale,
    102 - (y - (y0 + y1) / 2) * scale,
  ];
  return { scale, at };
}
export function dimensionLine(a: XY, b: XY, mode: DimensionMode) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    d = Math.hypot(dx, dy) || 1;
  let t: XY =
    mode === "horizontal"
      ? [1, 0]
      : mode === "vertical"
        ? [0, -1]
        : [dx / d, dy / d];
  if (t[0] < -1e-10 || (Math.abs(t[0]) <= 1e-10 && t[1] > 0))
    t = [-t[0], -t[1]];
  const normal: XY = [-t[1], t[0]];
  const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return { t, normal, mid };
}
export function dimensionMarks(
  dim: MeasuredDimension,
  at: (p: XY) => XY,
): Mark[] {
  const a = at(dim.a),
    b = at(dim.b),
    { t, normal, mid } = dimensionLine(a, b, dim.spec.mode);
  const dot = (p: XY) => p[0] * normal[0] + p[1] * normal[1];
  const station = dot(mid) + dim.offset;
  const lift = (p: XY): XY => [
    p[0] + (station - dot(p)) * normal[0],
    p[1] + (station - dot(p)) * normal[1],
  ];
  const A = lift(a),
    B = lift(b),
    layer = "Manual_dimensions";
  const marks: Mark[] = [path([A, B], layer, 0.2)];
  for (const [p, q] of [
    [a, A],
    [b, B],
  ]) {
    const dir = Math.sign(station - dot(p));
    if (Math.abs(station - dot(p)) > 1)
      marks.push(
        line(
          p[0] + dir * 0.6 * normal[0],
          p[1] + dir * 0.6 * normal[1],
          q[0] + dir * 1.2 * normal[0],
          q[1] + dir * 1.2 * normal[1],
          layer,
          0.13,
        ),
      );
    marks.push(
      line(
        q[0] - 0.8 * (t[0] - normal[0]),
        q[1] - 0.8 * (t[1] - normal[1]),
        q[0] + 0.8 * (t[0] - normal[0]),
        q[1] + 0.8 * (t[1] - normal[1]),
        layer,
        0.23,
      ),
    );
  }
  const caption = label(
    (A[0] + B[0]) / 2 - normal[0] * 1.35,
    (A[1] + B[1]) / 2 - normal[1] * 1.35,
    dim.text,
    3,
    "middle",
    layer,
  );
  caption.rotation = (Math.atan2(t[1], t[0]) * 180) / Math.PI;
  const textHalf = dim.text.length * 1.02;
  for (const p of [
    A,
    B,
    [caption.x + t[0] * textHalf, caption.y + t[1] * textHalf],
    [caption.x - t[0] * textHalf, caption.y - t[1] * textHalf],
  ]) {
    if (p[0] < 12 || p[0] > 285 || p[1] < 32 || p[1] > 175)
      throw Error(
        "This dimension extends outside the view. Move the dimension line closer to the part.",
      );
  }
  marks.push(caption);
  return marks;
}

// Sections on different planes may have identical point coordinates in different model axes.
export function sectionSnaps(
  drawing: ProjectedView,
  axis: "X" | "Y" | "Z",
  offset: number,
  project: Project,
  assembly: boolean,
) {
  const prefix = "section:" + axis + ":" + offset + ":";
  const direction = axis === "X" ? "right" : axis === "Y" ? "front" : "top";
  return dimensionSnaps(direction, drawing, [], project, !assembly).map(
    (s) => ({
      ...s,
      key: prefix + s.key,
      aliases: s.aliases.map((key) => prefix + key),
    }),
  );
}
