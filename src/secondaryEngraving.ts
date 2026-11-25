import { cadFont, flattenInk } from "./secondaryInk";
import type { Artwork, InkOutline } from "./markArtwork";
import { evaluate } from "./expressions";
import type { EvaluatedFeature, Feature, Project, Sketch } from "./types";
import {
  makeScale,
  supportedTick,
  tickContour,
  type ScaleLayout,
} from "./secondaryScale";
import type { XY } from "./secondaryVector";

export const scaleDefaults = {
  length: "150 mm",
  width: "25 mm",
  offset: "2 mm",
  major: "5 mm",
  mid: "3.5 mm",
  minor: "2 mm",
  weight: "0.15 mm",
  fontSize: "2.6 mm",
  rotation: "0 deg",
  frequency: "1",
  customStep: "1 mm",
  customRatio: "50",
  labelGap: "1 mm",
  angleStep: "1 deg",
  angleSpan: "180 deg",
  architectureRatio: "50",
};
export type FieldKey = keyof typeof scaleDefaults;
export const scaleKind = (key: FieldKey) =>
  key === "rotation" || key === "angleStep" || key === "angleSpan"
    ? "angle"
    : key === "frequency" ||
        key === "customRatio" ||
        key === "architectureRatio"
      ? "scalar"
      : "length";
export function getScaleLayout(
  cfg: Record<string, any>,
  values: Record<string, number>,
): ScaleLayout {
  const settings = {} as Record<FieldKey, number>;
  for (const key of Object.keys(scaleDefaults) as FieldKey[])
    settings[key] = evaluate(
      String(cfg[key] ?? scaleDefaults[key]),
      values,
      scaleKind(key),
    );
  return {
    ...settings,
    majorWeight: cfg.majorWeight
      ? evaluate(cfg.majorWeight, values)
      : settings.weight,
    midWeight: cfg.midWeight
      ? evaluate(cfg.midWeight, values)
      : settings.weight,
    bottomLabels:
      cfg.independentLabels &&
      (cfg.bottom ?? "in16") !== "off" &&
      cfg.layout !== "arc"
        ? {
            font: cfg.bottomFont ?? cfg.font ?? cadFont,
            fontSize: evaluate(
              String(
                cfg.bottomFontSize ?? cfg.fontSize ?? scaleDefaults.fontSize,
              ),
              values,
            ),
            labelGap: evaluate(
              String(
                cfg.bottomLabelGap ?? cfg.labelGap ?? scaleDefaults.labelGap,
              ),
              values,
            ),
            rotation: evaluate(
              String(
                cfg.bottomRotation ?? cfg.rotation ?? scaleDefaults.rotation,
              ),
              values,
              "angle",
            ),
            frequency: evaluate(
              String(
                cfg.bottomFrequency ?? cfg.frequency ?? scaleDefaults.frequency,
              ),
              values,
              "scalar",
            ),
          }
        : undefined,
    layout: cfg.layout || "linear",
    top: cfg.top || "mm",
    bottom: cfg.bottom ?? "in16",
    font: cfg.font || cadFont,
  };
}
function touches(a: XY[], b: XY[]) {
  for (const points of [a, b]) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i],
        q = points[(i + 1) % points.length],
        dx = q[1] - p[1],
        dy = p[0] - q[0];
      const pa = a.map(([x, y]) => x * dx + y * dy),
        pb = b.map(([x, y]) => x * dx + y * dy);
      if (
        Math.max(...pa) < Math.min(...pb) - 1e-8 ||
        Math.max(...pb) < Math.min(...pa) - 1e-8
      )
        return false;
    }
  }
  return true;
}
function outlineConflicts(labels: Artwork["outlines"], ticks: XY[][]) {
  const region = (loops: XY[][], ink: boolean) => {
    const edges = loops.flatMap((loop) =>
      loop.map((p, i) => [p, loop[(i + 1) % loop.length]] as [XY, XY]),
    );
    const points = loops.flat();
    return {
      edges,
      ink,
      x0: Math.min(...points.map((p) => p[0])),
      x1: Math.max(...points.map((p) => p[0])),
      y0: Math.min(...points.map((p) => p[1])),
      y1: Math.max(...points.map((p) => p[1])),
    };
  };
  const regions = [
    ...ticks.map((p) => region([p], false)),
    ...labels.map((g) =>
      region(
        [g.outer, ...g.holes].map((o) => flattenInk(o)),
        true,
      ),
    ),
  ].sort((a, b) => a.x0 - b.x0);
  function cross(a: XY, b: XY, p: XY) {
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  }
  function intersects(a: XY, b: XY, c: XY, d: XY) {
    for (const axis of [0, 1])
      if (
        Math.min(a[axis], b[axis]) > Math.max(c[axis], d[axis]) + 1e-8 ||
        Math.min(c[axis], d[axis]) > Math.max(a[axis], b[axis]) + 1e-8
      )
        return false;
    return (
      cross(a, b, c) * cross(a, b, d) <= 1e-12 &&
      cross(c, d, a) * cross(c, d, b) <= 1e-12
    );
  }
  function inside(p: XY, edges: [XY, XY][]) {
    let hit = false;
    for (const [a, b] of edges)
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        hit = !hit;
    return hit;
  }
  for (let i = 0; i < regions.length; i++)
    for (let j = i + 1; j < regions.length; j++) {
      const a = regions[i],
        b = regions[j];
      if (b.x0 > a.x1 + 1e-8) break;
      if ((!a.ink && !b.ink) || b.y0 > a.y1 + 1e-8 || a.y0 > b.y1 + 1e-8)
        continue;
      if (
        a.edges.some(([p, q]) =>
          b.edges.some(([r, s]) => intersects(p, q, r, s)),
        ) ||
        inside(a.edges[0][0], b.edges) ||
        inside(b.edges[0][0], a.edges)
      )
        return true;
    }
  return false;
}
export function evaluateScaleStock(
  project: Project,
  values: Record<string, number>,
  feature: Feature,
): EvaluatedFeature | null {
  const cfg = project.workspaces?.scale;
  if (!cfg || !isScaleFeature(project, feature.id)) return null;
  const attached = cfg.appliedId === feature.id;
  if (
    attached &&
    (!cfg.attachment || feature.bodyId !== cfg.attachment.targetBodyId)
  )
    throw Error(
      "Repair the target body in Scale studio before rebuilding the engraving.",
    );
  const c = getScaleLayout(cfg, values),
    sheet = makeScale(c).geometry,
    depth = evaluate(String(cfg.depth ?? "0.15 mm"), values),
    amount = attached ? depth : evaluate(feature.amount, values);
  if (!(depth > 0 && (attached || amount > depth)))
    throw Error(
      "Set engraving depth above zero and below stock thickness in Scale studio.",
    );
  if (attached && sheet.marks.some((m) => m.type === "text" && !m.ink))
    throw Error(
      "Choose a CAD outline typeface on each edge to engrave its labels into this part.",
    );
  const strokes = sheet.marks.filter((m) => m.type === "path");
  if (strokes.length > 650)
    throw Error(
      "This 3D cut supports up to 650 ticks. Increase the spacing, disable one edge, or shorten the scale.",
    );
  const ticks: XY[][] = [];
  const support: Record<number, XY[]> = {};
  const toStock = (polygon: XY[]): XY[] =>
    polygon.map(([x, y]) => [x, sheet.height - y]);
  for (const m of strokes) {
    const outline = tickContour(m, c);
    if (attached) {
      const inside = supportedTick(outline, c);
      if (inside !== outline) support[ticks.length] = toStock(inside);
    }
    ticks.push(toStock(outline));
  }
  const spans = ticks
    .map((p, i) => ({
      i,
      x0: Math.min(...p.map((v) => v[0])),
      x1: Math.max(...p.map((v) => v[0])),
      y0: Math.min(...p.map((v) => v[1])),
      y1: Math.max(...p.map((v) => v[1])),
    }))
    .sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < spans.length; i++)
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i],
        b = spans[j];
      if (b.x0 > a.x1 + 1e-7) break;
      if (b.y0 > a.y1 + 1e-7 || a.y0 > b.y1 + 1e-7) continue;
      if (touches(ticks[a.i], ticks[b.i]))
        throw Error(
          "Some engraving strokes overlap. Reduce line width or increase graduation spacing.",
        );
    }
  const labels: Artwork["outlines"] = [];
  const flip = (outline: InkOutline): InkOutline =>
    outline.map((seg) => seg.map(([x, y]) => [x, sheet.height - y]));
  for (const mark of sheet.marks) {
    if (mark.type !== "text" || !mark.ink) continue;
    for (const glyph of mark.ink) {
      const outer = flip(glyph.outer),
        polygon = flattenInk(outer);
      if (
        polygon.some(
          ([x, y]) =>
            x < -0.001 ||
            x > sheet.width + 0.001 ||
            y < -0.001 ||
            y > sheet.height + 0.001 ||
            (c.layout === "arc" &&
              Math.hypot(x - sheet.width / 2, y) > sheet.width / 2 + 0.001),
        )
      )
        throw Error(
          "A label extends beyond the stock. Move it inward, reduce the type size, or change its rotation.",
        );
      labels.push({ outer, holes: glyph.holes.map(flip) });
    }
  }
  if (outlineConflicts(labels, ticks))
    throw Error(
      "A number touches another cut. Increase its distance from the ticks, reduce its size, or change the label frequency.",
    );
  const r = c.length / 2;
  const outline: XY[] =
    c.layout === "linear"
      ? [
          [0, 0],
          [c.length, 0],
          [c.length, c.width],
          [0, c.width],
        ]
      : [
          [0, 0],
          [r, r],
          [c.length, 0],
        ];
  const edges =
    c.layout === "arc"
      ? [
          {
            start: { x: 0, y: 0 },
            through: { x: r, y: r },
            end: { x: c.length, y: 0 },
          },
          { start: { x: c.length, y: 0 }, end: { x: 0, y: 0 } },
        ]
      : undefined;
  return {
    id: feature.id,
    name: feature.name,
    operation: attached ? "cut" : "new",
    kind: "extrude",
    amount,
    points: outline,
    edges,
    ruler: {
      ticks,
      ...(Object.keys(support).length ? { support } : {}),
      depth,
      labels,
      ...(attached
        ? { placement: evaluatePlacement(cfg.attachment, values) }
        : {}),
    },
  };
}
export function withScaleModel(
  project: Project,
  values: Record<string, number>,
): Project {
  const cfg = project.workspaces?.scale || {},
    modelId = cfg.modelId || crypto.randomUUID(),
    sketchId = crypto.randomUUID();
  if (project.features.some((f) => f.id === modelId))
    throw Error("The generated stock already exists in feature history.");
  const c = getScaleLayout(cfg, values),
    l = String(cfg.length ?? scaleDefaults.length),
    w = String(cfg.width ?? scaleDefaults.width);
  const stock: Sketch = {
    id: sketchId,
    name: "Scale blank · generated",
    constraints: [],
    points:
      c.layout === "arc"
        ? [
            { x: "0", y: "0" },
            { x: "(" + l + ")/2", y: "(" + l + ")/2" },
            { x: l, y: "0" },
          ]
        : [
            { x: "0", y: "0" },
            { x: l, y: "0" },
            { x: l, y: w },
            { x: "0", y: w },
          ],
  };
  const body: Feature = {
    id: modelId,
    name: c.layout === "arc" ? "Engraved protractor" : "Engraved ruler",
    sketchId,
    kind: "extrude",
    amount: String(cfg.thickness ?? "2 mm"),
    operation: "new",
    suppressed: false,
  };
  const next = {
    ...project,
    sketches: [...project.sketches, stock],
    features: [...project.features, body],
    workspaces: { ...project.workspaces, scale: { ...cfg, modelId } },
  };
  evaluateScaleStock(next, values, body);
  return next;
}

export const scaleFaces = {
  top: "Top (+Z) · X / Y",
  bottom: "Bottom (−Z) · X / −Y",
  front: "Front (−Y) · X / Z",
  back: "Back (+Y) · −X / Z",
  right: "Right (+X) · Y / Z",
  left: "Left (−X) · −Y / Z",
};
export type ScaleFace = keyof typeof scaleFaces;
export type ScaleAttachment = {
  targetBodyId: string;
  face: ScaleFace;
  u: string;
  v: string;
  angle: string;
};
export type ScalePlacement = {
  face: ScaleFace;
  u: number;
  v: number;
  angle: number;
};
export function isScaleFeature(project: Project, id?: string) {
  const cfg = project.workspaces?.scale;
  return !!id && !!cfg && (cfg.modelId === id || cfg.appliedId === id);
}
function evaluatePlacement(
  ref: ScaleAttachment,
  values: Record<string, number>,
): ScalePlacement {
  if (!Object.hasOwn(scaleFaces, ref.face))
    throw Error("Choose a planar side of the part for engraving.");
  return {
    face: ref.face,
    u: evaluate(ref.u, values),
    v: evaluate(ref.v, values),
    angle: evaluate(ref.angle, values, "angle"),
  };
}
export function withScaleAttachment(
  project: Project,
  values: Record<string, number>,
  attachment: ScaleAttachment,
): Project {
  const cfg = project.workspaces?.scale || {};
  const source = project.features.find((f) => f.id === attachment.targetBodyId);
  if (
    !source ||
    source.suppressed ||
    source.operation !== "new" ||
    isScaleFeature(project, source.id)
  )
    throw Error("Choose an active part body for these graduations.");
  evaluatePlacement(attachment, values);
  const existing = project.features.find((f) => f.id === cfg.appliedId);
  if (existing?.suppressed)
    throw Error(
      "Restore the graduation cut in feature history before updating its placement.",
    );
  const id = existing?.id ?? crypto.randomUUID(),
    sketchId = existing?.sketchId ?? crypto.randomUUID();
  const f: Feature = {
    ...existing,
    id,
    sketchId,
    name: existing?.name ?? "Engraved graduations",
    kind: "extrude",
    operation: "cut",
    amount: String(cfg.depth ?? "0.15 mm"),
    bodyId: source.id,
    suppressed: false,
  };
  const features = project.features.filter((item) => item.id !== id);
  let index = features.findIndex((item) => item.id === source.id) + 1;
  while (index < features.length && features[index].operation !== "new")
    index++;
  // Retain downstream feature dependencies when editing placement on the same part.
  if (existing?.bodyId === source.id)
    index = project.features.findIndex((item) => item.id === id);
  features.splice(index, 0, f);
  const sketch: Sketch = {
    id: sketchId,
    name: "Graduation layout · generated",
    points: [
      { x: "0", y: "0" },
      { x: String(cfg.length ?? scaleDefaults.length), y: "0" },
      { x: "0", y: String(cfg.width ?? scaleDefaults.width) },
    ],
    constraints: [],
  };
  const next: Project = {
    ...project,
    features,
    sketches: existing ? project.sketches : [...project.sketches, sketch],
    workspaces: {
      ...project.workspaces,
      scale: { ...cfg, appliedId: id, attachment },
    },
  };
  evaluateScaleStock(next, values, f);
  return next;
}
