import {
  circle,
  label,
  line,
  path,
  type Mark,
  type XY,
} from "./secondaryVector";
import type { ProjectedView } from "./secondaryProjection";
import {
  sheetFrame,
  placeView,
  viewSize,
  appendDimensionSheets,
  dimensionViewCount,
  type TechSheet,
} from "./secondaryManufacturing";
import type { DrawingData } from "./secondaryDrawing";
import type { assemblyParts } from "./AssemblyBom";
import {
  explodeAssembly,
  type DrawingComponent,
  type ExplosionOptions,
  type ExplodedComponent,
} from "./assemblyExplosion";
import {
  assemblySectionSheets,
  standardScale,
  scaleTitle,
  type AssemblySection,
  type SectionDetail,
} from "./assemblySectionSheet";
import {
  formatDrawingLength,
  type MeasuredDimension,
} from "./drawingDimensions";
import { cutPlaneIndicator } from "./drawingSection";
import type { XYZ } from "./assemblyDrawingProjection";

export type AssemblyView = {
  simplified?: boolean;
  section?: AssemblySection;
  assembled: ProjectedView;
  bounds: [XYZ, XYZ];
  dimensions: XYZ;
  views: Record<"front" | "top" | "right" | "iso", ProjectedView>;
  parts: DrawingComponent[];
};
type BomRow = ReturnType<typeof assemblyParts>[number];
type Rect = [XY, XY];
const centerOf = ([[x, y], [xx, yy]]: Rect): XY => [(x + xx) / 2, (y + yy) / 2];
function page(marks: Mark[], title: string): TechSheet {
  return { label: title, sheet: { width: 297, height: 210, marks } };
}
function arrow(m: Mark[], at: XY, toward: XY) {
  const x = toward[0] - at[0],
    y = toward[1] - at[1],
    d = Math.hypot(x, y);
  if (d === 0) return;
  const u = x / d,
    v = y / d;
  m.push(
    path(
      [
        [at[0] + 1.7 * u + 0.45 * v, at[1] + 1.7 * v - 0.45 * u],
        at,
        [at[0] + 1.7 * u - 0.45 * v, at[1] + 1.7 * v + 0.45 * u],
      ],
      "Dimensions",
      0.16,
    ),
  );
}
function overall(
  m: Mark[],
  rect: Rect,
  value: number,
  kind: "horizontal" | "vertical",
) {
  const [[x, y], [xx, yy]] = rect;
  if (value < 1e-7) return;
  const a: XY = kind === "horizontal" ? [x, yy + 4.5] : [x - 4.5, y],
    b: XY = kind === "horizontal" ? [xx, yy + 4.5] : [x - 4.5, yy];
  if (kind === "horizontal")
    m.push(
      line(x, yy + 0.6, x, yy + 5.5, "Dimensions", 0.13),
      line(xx, yy + 0.6, xx, yy + 5.5, "Dimensions", 0.13),
    );
  else
    m.push(
      line(x - 0.6, y, x - 5.5, y, "Dimensions", 0.13),
      line(x - 0.6, yy, x - 5.5, yy, "Dimensions", 0.13),
    );
  m.push(path([a, b], "Dimensions", 0.16));
  arrow(m, a, b);
  arrow(m, b, a);
  const text = label(
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    formatDrawingLength(value),
    2.6,
    "middle",
    "Dimensions",
  );
  if (kind === "horizontal") text.y -= 0.8;
  else {
    text.x -= 0.9;
    text.rotation = -90;
  }
  m.push(text);
}
function homeSheet(
  data: AssemblyView,
  c: DrawingData,
  total: number,
  section?: AssemblySection,
  tolerance = "",
) {
  const boxes = [
    { k: "top", x: 82, y: 60, t: "Top", labelY: 30 },
    { k: "iso", x: 215, y: 60, t: "Isometric", labelY: 30 },
    { k: "front", x: 82, y: 131, t: "Front", labelY: 101 },
    { k: "right", x: 215, y: 131, t: "Right", labelY: 101 },
  ] as const;
  const fit = Math.min(
    ...boxes.map(({ k }) => {
      const [w, h] = viewSize(data.views[k]);
      return Math.min(112 / Math.max(w, 0.001), 57 / Math.max(h, 0.001));
    }),
  );
  const scale = c.scale === "auto" ? standardScale(fit) : c.scale;
  if (!(scale > 0 && scale <= fit + 1e-8))
    throw Error(
      "Select a smaller drawing scale or Fit to sheet to keep every assembly view within the border.",
    );
  const marks = sheetFrame(
    c,
    scaleTitle(scale),
    1,
    total,
    "ASSEMBLY · THIRD-ANGLE PROJECTION",
    "ASSEMBLY",
  );
  for (const { k, x, y, t, labelY } of boxes) {
    const view = data.views[k];
    // Hidden-line display may simplify thread crests. Anchor overall dimensions
    // at extrema of the actual B-rep in the same camera coordinates.
    const [cx, cy] = centerOf(view.bounds);
    const hAxis = k === "right" ? 1 : 0,
      vAxis = k === "top" ? 1 : 2;
    const [lo, hi] = data.bounds;
    const rect: Rect = [
      [x + (lo[hAxis] - cx) * scale, y - (hi[vAxis] - cy) * scale],
      [x + (hi[hAxis] - cx) * scale, y - (lo[vAxis] - cy) * scale],
    ];
    marks.push(label(x, labelY, t, 2.9, "middle"));
    placeView(marks, view, x, y, scale);
    if (section && k === (section.axis === "Y" ? "top" : "front"))
      marks.push(
        ...cutPlaneIndicator(view, section.axis, section.station, x, y, scale),
      );
    if (c.dimensions && k === "front") {
      overall(marks, rect, data.dimensions[0], "horizontal");
      overall(marks, rect, data.dimensions[2], "vertical");
    }
    if (c.dimensions && k === "right")
      overall(marks, rect, data.dimensions[1], "horizontal");
  }
  marks.push(
    label(
      14,
      172,
      c.dimensions
        ? "Home joint positions · Overall dimensions in mm"
        : "Home joint positions",
      2.6,
    ),
  );
  if (tolerance)
    marks.push(
      label(
        14,
        177,
        "Unless individually specified, linear tolerance ± " +
          tolerance +
          " mm.",
        2.45,
      ),
    );
  if (data.simplified)
    marks.push(label(284, 172, "Simplified thread outlines", 2.6, "end"));
  return { ...page(marks, "Assembly views"), scale };
}

type PaperPart = { item: number; rect: Rect; edges: XY[][] };
const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function nearestPoint(edges: XY[][], p: XY): XY {
  let best = edges[0][0],
    d = Infinity;
  for (const edge of edges)
    for (let j = 1; j < edge.length; j++) {
      const a = edge[j - 1],
        b = edge[j],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      const q: XY = [a[0] + t * dx, a[1] + t * dy],
        n = distance(p, q);
      if (n < d) {
        best = q;
        d = n;
      }
    }
  return best;
}
function crosses(a: XY, b: XY, [[x, y], [xx, yy]]: Rect) {
  let lo = 0,
    hi = 1;
  for (const [start, end, min, max] of [
    [a[0], b[0], x, xx],
    [a[1], b[1], y, yy],
  ]) {
    const diff = end - start;
    if (Math.abs(diff) < 1e-9) {
      if (start < min || start > max) return false;
    } else {
      const l = (min - start) / diff,
        h = (max - start) / diff;
      lo = Math.max(lo, Math.min(l, h));
      hi = Math.min(hi, Math.max(l, h));
    }
  }
  return lo <= hi;
}
function balloons(m: Mark[], parts: PaperPart[]) {
  const occupied: XY[] = [];
  for (const part of parts) {
    const [[x, y], [xx, yy]] = part.rect,
      [cx, cy] = centerOf(part.rect);
    let best: { p: XY; anchor: XY; score: number } | undefined;
    for (const gap of [7, 13, 21, 32]) {
      const choices: XY[] = [
        [xx + gap, y - gap],
        [x - gap, y - gap],
        [xx + gap, yy + gap],
        [x - gap, yy + gap],
        [cx, y - gap],
        [cx, yy + gap],
        [x - gap, cy],
        [xx + gap, cy],
      ];
      for (const q of choices) {
        const p: XY = [
          Math.max(15, Math.min(282, q[0])),
          Math.max(32, Math.min(163, q[1])),
        ];
        const anchor = nearestPoint(part.edges, p),
          dist = distance(p, anchor);
        let score = dist + (dist < 6 ? 600 : 0);
        for (const o of occupied) if (distance(p, o) < 9) score += 1000;
        for (const o of parts) {
          const [[a, b], [c, d]] = o.rect;
          if (p[0] > a - 4 && p[0] < c + 4 && p[1] > b - 4 && p[1] < d + 4)
            score += 1000;
          if (o !== part && crosses(p, anchor, o.rect)) score += 100;
        }
        if (!best || score < best.score) best = { p, anchor, score };
      }
    }
    const { p, anchor } = best!,
      d = distance(anchor, p);
    const radius = Math.max(2.9, String(part.item).length * 1.15 + 0.8);
    if (d > radius)
      m.push(
        line(
          anchor[0],
          anchor[1],
          p[0] + ((anchor[0] - p[0]) * radius) / d,
          p[1] + ((anchor[1] - p[1]) * radius) / d,
          "Balloons",
          0.2,
        ),
      );
    m.push(
      circle(p[0], p[1], radius, "Balloons"),
      label(p[0], p[1] + 0.9, String(part.item), 2.7, "middle", "Balloons"),
    );
    occupied.push(p);
  }
}
function explosionSheet(
  group: ExplodedComponent[],
  rows: Map<string, BomRow>,
  c: DrawingData,
  i: number,
  pageNumber: number,
  total: number,
  groups: number,
  simplified: boolean,
) {
  const m = sheetFrame(
    c,
    "NTS",
    pageNumber,
    total,
    "EXPLODED ASSEMBLY",
    "ASSEMBLY",
  );
  const minX = Math.min(...group.map((p) => p.bounds[0][0])),
    maxX = Math.max(...group.map((p) => p.bounds[1][0]));
  const minY = Math.min(...group.map((p) => p.bounds[0][1])),
    maxY = Math.max(...group.map((p) => p.bounds[1][1]));
  const scale = Math.min(
    245 / Math.max(maxX - minX, 0.001),
    103 / Math.max(maxY - minY, 0.001),
  );
  const toPaper = ([x, y]: XY): XY => [
    148.5 + (x - (minX + maxX) / 2) * scale,
    99 - (y - (minY + maxY) / 2) * scale,
  ];
  const pp: PaperPart[] = group.map((p) => {
    const edges = p.view.paths.map((edge) =>
      edge.map(([x, y]) => toPaper([x + p.shift[0], y + p.shift[1]])),
    );
    for (const edge of edges) m.push(path(edge, "Exploded_edges", 0.24));
    const [left, bottom] = toPaper(p.bounds[0]),
      [right, top] = toPaper(p.bounds[1]);
    return {
      item: rows.get(p.id)!.item,
      edges,
      rect: [
        [left, top],
        [right, bottom],
      ],
    };
  });
  balloons(m, pp);
  m.push(
    label(14, 28, "Exploded view", 4),
    label(14, 172, "Balloon numbers refer to the bill of materials.", 2.6),
  );
  if (simplified)
    m.push(label(284, 172, "Simplified thread outlines", 2.6, "end"));
  return page(
    m,
    groups === 1 ? "Exploded assembly" : "Exploded assembly " + (i + 1),
  );
}
const bomColumnX = [14, 29, 95, 105, 136, 217, 284];
const bomTextSize = 2.45;

// Conservative glyph advances in ems keep long component and library names
// inside their columns across the SVG, PDF and DXF sans-serif fonts.
function glyphWidth(c: string) {
  if (/[il.:,'!| ]/.test(c)) return 0.37;
  if (/[A-Z]/.test(c)) return /[MW]/.test(c) ? 1.03 : 0.81;
  if (/[a-z0-9]/.test(c)) return /[mw]/.test(c) ? 0.98 : 0.68;
  return 1.12;
}
function wrap(s: string, width: number) {
  const chars = Array.from(s.trim());
  const lines: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = start,
      space = -1,
      advance = 0;
    while (end < chars.length) {
      const next = advance + glyphWidth(chars[end]) * bomTextSize;
      if (next > width && end > start) break;
      if (chars[end] === " ") space = end;
      advance = next;
      end++;
    }
    if (end < chars.length && space > start) end = space;
    lines.push(chars.slice(start, end).join(""));
    start = end;
    while (chars[start] === " ") start++;
  }
  return lines.length ? lines : [""];
}
function bomPages(bom: BomRow[]) {
  const pages: { item: number; lines: string[][] }[][] = [];
  let used = 0;
  for (const r of bom) {
    const columns = [
      String(r.item),
      r.name,
      String(r.quantity),
      r.material,
      r.source + (r.specification ? " · " + r.specification : ""),
      r.joint + " · " + r.parent,
    ];
    const split = columns.map((s, i) =>
      wrap(s, bomColumnX[i + 1] - bomColumnX[i] - 2),
    );
    const height = Math.max(...split.map((col) => col.length));
    for (let start = 0; start < height; ) {
      if (
        !pages.length ||
        used === 20 ||
        (start === 0 && used > 0 && height <= 20 && height > 20 - used)
      ) {
        pages.push([]);
        used = 0;
      }
      const count = Math.min(20 - used, height - start);
      const lines = split.map((col) => col.slice(start, start + count));
      if (start > 0) lines[0] = [String(r.item)];
      pages[pages.length - 1].push({ item: r.item, lines });
      used += count;
      start += count;
    }
  }
  return pages;
}
export function assemblySheets(
  data: AssemblyView,
  c: DrawingData,
  bom: BomRow[],
  options: ExplosionOptions & {
    section?: AssemblySection;
    detail?: SectionDetail;
    manualDimensions?: MeasuredDimension[];
    tolerance?: string;
  } = {},
): TechSheet[] {
  const rows = new Map(bom.map((r) => [r.bodyId, r]));
  if (
    !data.parts.length ||
    data.parts.length !== rows.size ||
    data.parts.some((p) => !rows.has(p.id))
  )
    throw Error(
      "The assembly parts list has changed. Rebuild the assembly drawing.",
    );
  const ordered = data.parts
    .slice()
    .sort((a, b) => rows.get(a.id)!.item - rows.get(b.id)!.item);
  const exploded = explodeAssembly(ordered, options),
    groups = Math.ceil(exploded.length / 10),
    tables = bomPages(bom);
  const { section, detail, manualDimensions = [] } = options;
  if (detail && !section)
    throw Error("Enable an assembly section to create its detail view.");
  const total =
      1 +
      groups +
      tables.length +
      (section ? (detail ? 2 : 1) : 0) +
      dimensionViewCount(manualDimensions),
    sheets: TechSheet[] = [
      homeSheet(data, c, total, section, options.tolerance),
    ];
  if (section)
    sheets.push(
      ...assemblySectionSheets(
        section,
        c,
        rows,
        total,
        detail,
        options.tolerance,
      ),
    );
  for (let i = 0; i < groups; i++)
    sheets.push(
      explosionSheet(
        exploded.slice(i * 10, (i + 1) * 10),
        rows,
        c,
        i,
        sheets.length + 1,
        total,
        groups,
        !!data.simplified,
      ),
    );
  tables.forEach((table, i) => {
    const m = sheetFrame(
      c,
      "—",
      sheets.length + 1,
      total,
      "ASSEMBLY PARTS LIST",
      "ASSEMBLY",
    );
    m.push(label(14, 30, "Bill of materials", 4.5));
    const headings = [
      "ITEM",
      "COMPONENT",
      "QTY",
      "MATERIAL",
      "SOURCE / SPECIFICATION",
      "JOINT / PARENT",
    ];
    headings.forEach((s, j) => m.push(label(bomColumnX[j], 42, s, 2.35)));
    let y = 49;
    for (const row of table) {
      m.push(line(13, y - 4.2, 284, y - 4.2, "Border", 0.12));
      for (const [j, lines] of row.lines.entries())
        lines.forEach((s, k) =>
          m.push(label(bomColumnX[j], y + k * 6.15, s, bomTextSize)),
        );
      y += Math.max(...row.lines.map((col) => col.length)) * 6.15;
    }
    sheets.push(
      page(m, i ? "Bill of materials " + (i + 1) : "Bill of materials"),
    );
  });
  appendDimensionSheets(
    sheets,
    { ...data.views, section: section?.view },
    c,
    options.tolerance || "",
    manualDimensions,
    total,
    "ASSEMBLY",
  );
  return sheets;
}
