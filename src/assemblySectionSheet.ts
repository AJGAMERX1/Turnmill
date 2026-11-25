import type { ProjectedView, SectionAxis } from "./secondaryProjection";
import type { DrawingData } from "./secondaryDrawing";
import {
  clippedView,
  sheetFrame,
  viewSize,
  type TechSheet,
} from "./secondaryManufacturing";
import { label, line, n, path, type Mark, type XY } from "./secondaryVector";
import type { assemblyParts } from "./AssemblyBom";
import { formatDrawingLength } from "./drawingDimensions";

export type AssemblySection = {
  axis: SectionAxis;
  station: number;
  offset: number;
  view: ProjectedView;
  parts: { id: string; view: ProjectedView }[];
};
export type SectionDetail = { width: number; end: "start" | "end" };
type Rectangle = [XY, XY];
type BomRow = ReturnType<typeof assemblyParts>[number];

export function standardScale(fit: number) {
  const power = 10 ** Math.floor(Math.log10(fit)),
    normalized = fit / power;
  return (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * power;
}
export function scaleTitle(v: number) {
  return v >= 1 ? n(v) + ":1" : "1:" + n(1 / v);
}

function hatchAngle(item: number) {
  return [1, -1, 0.58, -0.58][(item - 1) % 4];
}
function hatchSpacing(item: number) {
  return 2.1 + (Math.floor((item - 1) / 4) % 3) * 0.45;
}

// All crossings are taken from one complete component section so a bore or a
// detail crop never joins the section of an adjacent part.
function hatch(m: Mark[], contours: XY[][], item: number, clip: Rectangle) {
  const slope = hatchAngle(item),
    pitch = hatchSpacing(item) * Math.hypot(1, slope);
  const phase = ((item * 0.618034) % 1) * pitch;
  const [[left, top], [right, bottom]] = clip;
  const lo = top - Math.max(left * slope, right * slope),
    hi = bottom - Math.min(left * slope, right * slope);
  for (
    let offset = Math.ceil((lo - phase) / pitch) * pitch + phase;
    offset < hi;
    offset += pitch
  ) {
    const hits: number[] = [];
    for (const edge of contours)
      for (let j = 1; j < edge.length; j++) {
        const a = edge[j - 1],
          b = edge[j],
          va = a[1] - slope * a[0],
          vb = b[1] - slope * b[0];
        if ((va <= offset && offset < vb) || (vb <= offset && offset < va))
          hits.push(a[0] + ((b[0] - a[0]) * (offset - va)) / (vb - va));
      }
    hits.sort((a, b) => a - b);
    for (let j = 0; j + 1 < hits.length; j += 2) {
      const start = Math.max(left, hits[j]),
        end = Math.min(right, hits[j + 1]);
      if (end - start > 0.04)
        m.push(
          line(
            start,
            slope * start + offset,
            end,
            slope * end + offset,
            "Section_hatch_" + item,
            0.12,
          ),
        );
    }
  }
}

export function assemblySectionSheets(
  s: AssemblySection,
  c: DrawingData,
  rows: Map<string, BomRow>,
  total: number,
  detail?: SectionDetail,
  tolerance = "",
): TechSheet[] {
  if (!s.parts.some((p) => p.view.paths.length) || !s.view.paths.length)
    throw Error(
      "The section plane passes through empty space. Move the offset into an assembly component.",
    );
  const sections = s.parts
    .map((p) => {
      const row = rows.get(p.id);
      if (!row)
        throw Error(
          "A sectioned component is missing from the bill of materials. Rebuild the assembly drawing.",
        );
      return { ...p, item: row.item };
    })
    .filter((p) => p.view.paths.length)
    .sort((a, b) => a.item - b.item);
  const [a, b] = s.view.bounds.map((p) => p[0]);
  if (detail && !(detail.width > 0 && detail.width <= b - a + 1e-7))
    throw Error(
      "Choose a positive detail width no wider than the assembly section.",
    );
  const interval: XY | undefined = detail
    ? detail.end === "end"
      ? [b - detail.width, b]
      : [a, a + detail.width]
    : undefined;
  const axisU = s.axis === "X" ? "Y" : "X";
  function draw(isDetail: boolean, parentScale = 0): TechSheet {
    const crop = isDetail ? interval : undefined;
    const view = crop ? clippedView(s.view, crop[0], crop[1]) : s.view;
    if (!view.paths.length)
      throw Error(
        "The detail region misses the section. Adjust its width or choose the opposite end.",
      );
    const [w, h] = viewSize(view),
      max = Math.min(
        243 / Math.max(w, 0.001),
        (isDetail ? 96 : 85) / Math.max(h, 0.001),
      );
    let scale = c.scale === "auto" ? standardScale(max) : c.scale;
    if (isDetail) {
      const decade = 10 ** Math.floor(Math.log10(max));
      scale =
        ([8, 6, 5, 4, 3, 2.5, 2, 1.5, 1].find((n) => n * decade <= max) ?? 1) *
        decade;
      if (scale <= parentScale && max > parentScale) scale = max;
      if (scale <= parentScale)
        throw Error(
          "Choose a narrower detail interval or a smaller assembly scale so the detail can be enlarged.",
        );
    }
    if (scale > max + 1e-7)
      throw Error(
        "The assembly section exceeds this sheet. Choose Fit to sheet or a smaller scale.",
      );
    const title = isDetail ? "Section detail B" : "Assembly section A–A";
    const m = sheetFrame(
      c,
      scaleTitle(scale),
      isDetail ? 3 : 2,
      total,
      isDetail ? "DETAIL B · SECTION A–A" : "SECTION A–A",
      "ASSEMBLY",
    );
    const [[xmin, ymin], [xmax, ymax]] = view.bounds;
    const toPage = ([x, y]: XY): XY => [
      148.5 + (x - (xmin + xmax) / 2) * scale,
      100 - (y - (ymin + ymax) / 2) * scale,
    ];
    const region: Rectangle = [toPage([xmin, ymax]), toPage([xmax, ymin])];
    const visible: typeof sections = [];
    for (const component of sections) {
      const outline = crop
        ? clippedView(component.view, crop[0], crop[1])
        : component.view;
      if (!outline.paths.length) continue;
      visible.push(component);
      if (c.hatch)
        hatch(
          m,
          component.view.paths.map((edge) => edge.map(toPage)),
          component.item,
          region,
        );
      for (const edge of outline.paths)
        m.push(path(edge.map(toPage), "Section_item_" + component.item, 0.24));
    }
    m.push(
      label(14, 30, title, 4),
      label(
        14,
        39,
        s.axis +
          " = " +
          formatDrawingLength(s.station) +
          " mm in assembly coordinates · Offset from assembly center " +
          formatDrawingLength(s.offset) +
          " mm",
        2.65,
      ),
    );
    if (crop)
      m.push(
        label(
          14,
          46,
          "Detail interval  " +
            axisU +
            " = " +
            formatDrawingLength(crop[0]) +
            " to " +
            formatDrawingLength(crop[1]) +
            " mm",
          2.65,
        ),
      );
    else if (interval) {
      const left = toPage([interval[0], ymin])[0],
        right = toPage([interval[1], ymin])[0];
      const y = region[1][1] + 3.5;
      m.push(
        path(
          [
            [left, y - 1.7],
            [left, y],
            [right, y],
            [right, y - 1.7],
          ],
          "Detail_boundary",
          0.2,
        ),
        label(
          (left + right) / 2,
          y + 3.2,
          "B",
          2.6,
          "middle",
          "Detail_boundary",
        ),
      );
    }
    if (visible.length <= 18) {
      m.push(label(14, 155, "BOM item", 2.6));
      for (const [i, p] of visible.entries()) {
        const x = 14 + (i % 9) * 30,
          y = 161 + Math.floor(i / 9) * 9;
        if (c.hatch) {
          const box: XY[] = [
            [x, y - 2],
            [x + 7, y - 2],
            [x + 7, y + 1],
            [x, y + 1],
            [x, y - 2],
          ];
          hatch(m, [box], p.item, [
            [x, y - 2],
            [x + 7, y + 1],
          ]);
          m.push(path(box, "Section_key", 0.13));
        }
        m.push(label(x + (c.hatch ? 8.5 : 0), y + 0.7, String(p.item), 2.65));
      }
    } else
      m.push(
        label(
          14,
          167,
          "Component boundaries and cut patterns use the numbered bill of materials.",
          2.6,
        ),
      );
    if (tolerance)
      m.push(
        label(
          14,
          177,
          "Unless individually specified, linear tolerance ± " +
            tolerance +
            " mm.",
          2.45,
        ),
      );
    return {
      label: title,
      scale,
      sheet: { width: 297, height: 210, marks: m },
    };
  }
  const full = draw(false);
  return interval ? [full, draw(true, full.scale)] : [full];
}
