import type { EvaluatedFeature } from "./types";
import type { ProjectedBody, ProjectedView } from "./secondaryProjection";
import {
  circle,
  label,
  line,
  n,
  path,
  type Mark,
  type Sheet,
  type XY,
} from "./secondaryVector";
import type { DrawingData } from "./secondaryDrawing";
import { sectionIndicator } from "./drawingSection";
import {
  formatTolerance,
  formatDrawingLength,
  dimensionLayout,
  dimensionMarks,
  dimensionSheetName,
  dimensionViewNames,
  type MeasuredDimension,
  type DimensionGeometry,
} from "./drawingDimensions";
export type TechSheet = { label: string; sheet: Sheet; scale?: number };
function tickDimension(
  m: Mark[],
  a: XY,
  b: XY,
  title: string,
  vertical = false,
) {
  m.push(path([a, b], "Dimensions", 0.16));
  for (const [x, y] of [a, b])
    m.push(line(x - 0.8, y + 0.8, x + 0.8, y - 0.8, "Dimensions", 0.23));
  const t = label(
    (a[0] + b[0]) / 2 - (vertical ? 1.5 : 0),
    (a[1] + b[1]) / 2 - (vertical ? 0 : 1.3),
    title,
    2.6,
    "middle",
    "Dimensions",
  );
  if (vertical) t.rotation = -90;
  m.push(t);
}
function hatchContours(m: Mark[], contours: XY[][], clip?: [XY, XY]) {
  const edges = contours.flatMap((loop) =>
    loop.slice(1).map((end, i) => [loop[i], end]),
  );
  if (!edges.length) return;
  let lo = Infinity,
    hi = -Infinity;
  for (const [a, b] of edges) {
    lo = Math.min(lo, a[1] - a[0], b[1] - b[0]);
    hi = Math.max(hi, a[1] - a[0], b[1] - b[0]);
  }
  if (clip) {
    lo = Math.max(lo, clip[0][1] - clip[1][0]);
    hi = Math.min(hi, clip[1][1] - clip[0][0]);
  }
  for (let v = Math.ceil(lo / 2.4) * 2.4; v < hi; v += 2.4) {
    const xs: number[] = [];
    for (const [a, b] of edges) {
      const p = a[1] - a[0],
        q = b[1] - b[0];
      if ((p <= v && v < q) || (q <= v && v < p))
        xs.push(a[0] + ((b[0] - a[0]) * (v - p)) / (q - p));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = clip ? Math.max(xs[i], clip[0][0], clip[0][1] - v) : xs[i];
      const x1 = clip
        ? Math.min(xs[i + 1], clip[1][0], clip[1][1] - v)
        : xs[i + 1];
      if (x1 - x0 > 0.06)
        m.push(line(x0, x0 + v, x1, x1 + v, "Section_hatch", 0.12));
    }
  }
}
export const viewSize = (v: ProjectedView): XY => [
  v.bounds[1][0] - v.bounds[0][0],
  v.bounds[1][1] - v.bounds[0][1],
];
export function placeView(
  m: Mark[],
  view: ProjectedView,
  cx: number,
  cy: number,
  scale: number,
  hatch = false,
) {
  const [[xa, ya], [xb, yb]] = view.bounds;
  const mx = (xa + xb) / 2,
    my = (ya + yb) / 2;
  const pts = view.paths.map((line) =>
    line.map(([x, y]) => [cx + (x - mx) * scale, cy - (y - my) * scale] as XY),
  );
  if (hatch) hatchContours(m, pts);
  for (const p of pts) m.push(path(p, "Projected_edges", 0.24));
}
function fmtScale(v: number) {
  return v >= 1 ? n(v) + ":1" : "1:" + n(1 / v);
}
export function sheetFrame(
  c: DrawingData,
  scale: string,
  num: number,
  total: number,
  subject: string,
  titleField = "PART",
): Mark[] {
  const m: Mark[] = [
    path(
      [
        [7, 7],
        [290, 7],
        [290, 203],
        [7, 203],
      ],
      "Border",
      0.35,
      true,
    ),
  ];
  m.push(
    label(12, 14, "TURNMILL", 3.1),
    label(284, 14, subject, 2.7, "end"),
    line(7, 18, 290, 18, "Border", 0.18),
  );
  m.push(
    line(7, 181, 290, 181, "Border", 0.28),
    line(149, 181, 149, 203, "Border", 0.18),
    line(208, 181, 208, 196.2, "Border", 0.18),
    line(242, 181, 242, 196.2, "Border", 0.18),
    line(267, 181, 267, 196.2, "Border", 0.18),
    line(149, 196.2, 290, 196.2, "Border", 0.14),
  );
  function field(
    x: number,
    y: number,
    value: string,
    width: number,
    size: number,
    name: string,
  ) {
    // Reserve the glyph's advance rather than clipping the designer's text.
    const ems = [...value].reduce(
      (sum, ch) =>
        sum +
        (/[ilI., '!|:]/.test(ch)
          ? 0.4
          : /[MW@%]/.test(ch)
            ? 1.08
            : /[A-Z]/.test(ch)
              ? 0.83
              : /[a-z0-9]/.test(ch)
                ? 0.7
                : 1.05),
      0,
    );
    const fit = Math.min(size, width / Math.max(ems, 1));
    if (fit < 1.9)
      throw Error(
        "Shorten the " +
          name +
          " in the title block so it fits at a readable size.",
      );
    m.push(label(x, y, value, fit));
  }
  for (const [x, title, value, width] of [
    [12, titleField, c.title, 133],
    [153, "DRAWING NO.", c.number, 52],
    [212, "SCALE", scale, 27],
    [246, "REV.", c.revision, 18],
    [270, "SHEET", num + " / " + total, 18],
  ] as [number, string, string, number][]) {
    m.push(label(x, 187, title, 2.2));
    field(x, 194, value, width, x === 12 ? 3.5 : 2.95, title.toLowerCase());
  }
  if (c.material)
    field(12, 199.6, "Material: " + c.material, 132, 2.5, "material");
  if (c.note) field(153, 200.6, c.note, 133, 2.4, "shop note");
  return m;
}
function finishNotes(features: EvaluatedFeature[]) {
  const notes: string[] = [];
  let holeCount = 0;
  for (const f of features) {
    if (f.ruler) {
      const side = f.ruler.placement?.face || "top";
      notes.push(
        `Engrave ${f.ruler.ticks.length} graduations · ${formatDrawingLength(f.ruler.depth)} mm deep · ${side} face`,
      );
      if (f.ruler.placement) {
        const { u, v, angle } = f.ruler.placement;
        notes.push(
          `Graduation layout origin · U ${formatDrawingLength(u)} mm, V ${formatDrawingLength(v)} mm · rotation ${n(angle, 6)}°`,
        );
      }
    }
    for (const op of f.finishes || []) {
      if (op.suppressed) continue;
      const end = op.end === "start" ? "start end" : "far end";
      if (op.kind === "thread") {
        const call =
          op.preset &&
          op.preset !== "custom" &&
          !op.preset.toLowerCase().includes("custom")
            ? op.preset
            : "Ø " +
              formatDrawingLength(op.diameter) +
              " × " +
              formatDrawingLength(op.pitch) +
              " pitch";
        notes.push(
          call +
            " · " +
            op.side +
            " · " +
            (op.hand === "right" ? "RH" : "LH") +
            " · " +
            formatDrawingLength(op.length) +
            " mm long · " +
            end +
            " · " +
            op.mode,
        );
      } else if (op.kind === "knurl")
        notes.push(
          (op.style === "diamond" ? "Diamond" : "Straight") +
            " knurl · " +
            String(op.count) +
            " grooves · Ø " +
            formatDrawingLength(op.diameter) +
            " · length " +
            formatDrawingLength(op.length) +
            " · depth " +
            formatDrawingLength(op.depth),
        );
      else if (op.kind === "mark")
        notes.push(
          (op.method === "engrave" ? "Engrave " : "Emboss ") +
            op.name +
            " · height " +
            formatDrawingLength(op.height) +
            " · depth " +
            formatDrawingLength(op.depth),
        );
      else if (op.kind === "hole") {
        const hole = `Hole ${++holeCount}`;
        const turning = f.kind === "revolve";
        const axis = turning ? "X" : "Z";
        const side = op.end === "start" ? "min" : "max";
        // A legacy depth cut could extend past the stock and had no explicit termination.
        let depth = `· drill travel ${formatDrawingLength(op.length)}`;
        if (op.termination === "blind")
          depth = `× ${formatDrawingLength(op.length)} deep`;
        if (op.termination === "through") depth = "THRU";
        notes.push(
          `${hole} · Ø ${formatDrawingLength(op.diameter)} ${depth} · from ${axis} ${side}`,
        );
        if (
          op.profile === "counterbore" &&
          op.seatDiameter != null &&
          op.seatDepth != null
        )
          notes.push(
            `${hole} · Counterbore Ø ${formatDrawingLength(op.seatDiameter)} × ${formatDrawingLength(op.seatDepth)} deep`,
          );
        if (
          op.profile === "countersink" &&
          op.seatDiameter != null &&
          op.seatAngle != null
        )
          notes.push(
            `${hole} · Countersink Ø ${formatDrawingLength(op.seatDiameter)} × ${n(op.seatAngle, 6)}° included`,
          );
        const u = formatDrawingLength(op.offsetU ?? 0),
          v = formatDrawingLength(op.offsetV ?? 0);
        notes.push(
          turning
            ? `${hole} center · Y ${u}, Z ${v} from the turning axis`
            : `${hole} center · X ${u}, Y ${v} from the stock bounds center`,
        );
      } else if (op.kind === "chamfer" || op.kind === "fillet")
        notes.push(
          (op.kind === "fillet" ? "Fillet R" : "Chamfer ") +
            formatDrawingLength(op.size) +
            " · " +
            op.rims +
            " rim · " +
            end,
        );
    }
  }
  return notes;
}
export type SheetOptions = {
  manualDimensions?: MeasuredDimension[];
  detail?: { end: "start" | "end"; width: number };
  form?: { kind: "roundness" | "straightness"; key: string; value: number };
  datum?: { key: string; letter: string };
};
export const surfaceKey = (face: ProjectedBody["stations"][number]) =>
  [
    face.side,
    face.diameter.toFixed(6),
    face.xMin.toFixed(6),
    face.xMax.toFixed(6),
  ].join("/");

export function clippedView(
  view: ProjectedView,
  lo: number,
  hi: number,
): ProjectedView {
  const paths: XY[][] = [];
  let y0 = Infinity,
    y1 = -Infinity;
  for (const points of view.paths) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b[0] - a[0];
      if (Math.max(a[0], b[0]) < lo || Math.min(a[0], b[0]) > hi) continue;
      let t0 = 0,
        t1 = 1;
      if (Math.abs(dx) > 1e-12) {
        const u = (lo - a[0]) / dx,
          v = (hi - a[0]) / dx;
        t0 = Math.max(0, Math.min(u, v));
        t1 = Math.min(1, Math.max(u, v));
      }
      if (t1 - t0 < 1e-10) continue;
      const segment = [t0, t1].map(
        (t) => [a[0] + t * dx, a[1] + t * (b[1] - a[1])] as XY,
      );
      paths.push(segment);
      y0 = Math.min(y0, segment[0][1], segment[1][1]);
      y1 = Math.max(y1, segment[0][1], segment[1][1]);
    }
  }
  return {
    paths,
    bounds: [
      [lo, y0],
      [hi, y1],
    ],
  };
}
export function manufacturingSheets(
  data: ProjectedBody,
  c: DrawingData,
  features: EvaluatedFeature[],
  tolerance: string,
  options: SheetOptions = {},
): { sheets: TechSheet[]; scale: number } {
  const {
    views,
    dimensions: [X, Y, Z],
  } = data;
  const sizes = [
    { v: views.front, ww: 151, hh: 33 },
    { v: views.top, ww: 151, hh: 30 },
    { v: views.right, ww: 66, hh: 34 },
    { v: views.section, ww: 224, hh: 31 },
  ];
  const room = Math.min(
    ...sizes.flatMap(({ v, ww, hh }) => {
      const [w, h] = viewSize(v);
      return [w > 0 ? ww / w : Infinity, h > 0 ? hh / h : Infinity];
    }),
  );
  const common = [
    10, 5, 4, 2, 1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.025, 0.02, 0.01, 0.005, 0.001,
  ];
  const scale =
    c.scale === "auto"
      ? (common.find((v) => v <= room + 1e-8) ?? room)
      : c.scale;
  if (!(scale > 0) || scale > room + 1e-6)
    throw Error(
      "The finished body exceeds this sheet at the selected scale. Select Fit to sheet or a smaller scale.",
    );
  const [iw, ih] = viewSize(views.iso),
    isoScale = Math.min(72 / (iw || 1), 31 / (ih || 1));
  const notes = finishNotes(features);
  const rows = [
    ["Overall X length", formatDrawingLength(X), "mm"],
    ["Overall Y width", formatDrawingLength(Y), "mm"],
    ["Overall Z height", formatDrawingLength(Z), "mm"],
    [
      "Section at " + (data.sectionAxis || "Y"),
      formatDrawingLength(data.sectionStation),
      "mm · model coordinates",
    ],
  ];
  // Source geometry supplies callouts; overall dimensions come from the final solid.
  for (const row of data.stations || [])
    rows.push([
      row.side === "internal"
        ? "Bore diameter"
        : row.side === "external"
          ? "Outside diameter"
          : "Cylindrical diameter",
      "Ø " + formatDrawingLength(row.diameter),
      "X " +
        formatDrawingLength(row.xMin) +
        " … " +
        formatDrawingLength(row.xMax),
    ]);
  for (const item of notes) rows.push(["Feature callout", item, ""]);
  if (tolerance)
    rows.push(["General linear tolerance", "± " + tolerance, "mm"]);
  const form = options.form;
  if (form) {
    if (!(form.value > 0)) throw Error("Enter a positive geometric tolerance.");
    const face = data.stations.find((s) => surfaceKey(s) === form.key);
    if (!face)
      throw Error(
        "The surface linked to the form control changed or disappeared. Open Annotations and select its replacement before exporting.",
      );
    rows.push([
      "Form control",
      form.kind.toUpperCase() + "|" + formatTolerance(form.value),
      "Ø " +
        formatDrawingLength(face.diameter) +
        "  ·  X " +
        formatDrawingLength(face.xMin) +
        " … " +
        formatDrawingLength(face.xMax),
    ]);
  }
  if (options.datum) {
    if (!/^[A-Z]$/.test(options.datum.letter))
      throw Error("Use one uppercase letter for the datum identifier.");
    const face = data.stations.find(
      (s) => surfaceKey(s) === options.datum!.key,
    );
    if (!face)
      throw Error(
        "The datum feature changed or disappeared. Open Annotations and select its replacement before exporting.",
      );
    rows.push([
      "Datum feature",
      options.datum.letter,
      "Ø " +
        formatDrawingLength(face.diameter) +
        "  ·  X " +
        formatDrawingLength(face.xMin) +
        " … " +
        formatDrawingLength(face.xMax),
    ]);
  }
  const dimensionCount = dimensionViewCount(options.manualDimensions || []);
  const extra = options.detail ? 1 : 0;
  const rowCount = 18,
    additional = Math.max(1, Math.ceil(rows.length / rowCount)),
    total = 1 + additional + extra + dimensionCount;
  const m = sheetFrame(
    c,
    fmtScale(scale),
    1,
    total,
    "THIRD-ANGLE PROJECTION · DIMENSIONS IN mm",
  );
  m.push(
    label(24, 25, "TOP", 2.55),
    label(204, 25, "ISOMETRIC  ·  NTS", 2.55),
    label(24, 72, "FRONT", 2.55),
    label(204, 72, "RIGHT", 2.55),
  );
  placeView(m, views.top, 103, 45, scale);
  placeView(m, views.front, 103, 89, scale);
  placeView(m, views.right, 241, 89, scale);
  placeView(m, views.iso, 241, 45, isoScale);
  m.push(...sectionIndicator(data, scale));
  if (data.simplified)
    m.push(label(15, 113, "EXTERIOR VIEWS: THREAD HELICES OMITTED", 2.1));
  m.push(line(7, 119, 290, 119, "Border", 0.16));
  placeView(m, views.section, 143, 147, scale, c.hatch);
  if (!views.section.paths.length)
    m.push(
      label(
        143,
        147,
        "The section plane does not intersect this solid.",
        3,
        "middle",
      ),
    );
  if (c.dimensions) {
    const left = 103 - (X * scale) / 2,
      right = 103 + (X * scale) / 2,
      base = 89 + (Z * scale) / 2,
      dimY = Math.min(116, base + (data.sectionAxis === "X" ? 10 : 6));
    m.push(
      line(left, base + 0.9, left, dimY + 1.2, "Dimensions", 0.14),
      line(right, base + 0.9, right, dimY + 1.2, "Dimensions", 0.14),
    );
    tickDimension(m, [left, dimY], [right, dimY], formatDrawingLength(X));
    const v = (height: number, cy: number) => {
      const top = cy - (height * scale) / 2,
        bot = cy + (height * scale) / 2,
        dx =
          left -
          ((cy === 45 && data.sectionAxis === "Y") ||
          (cy === 89 && data.sectionAxis === "Z")
            ? 15
            : 5.5);
      m.push(
        line(dx - 1, top, left - 0.8, top, "Dimensions", 0.14),
        line(dx - 1, bot, left - 0.8, bot, "Dimensions", 0.14),
      );
      tickDimension(m, [dx, top], [dx, bot], formatDrawingLength(height), true);
    };
    v(Z, 89);
    v(Y, 45);
  }
  m.push(
    label(
      13,
      172,
      notes[0] ? "1. " + notes[0] : "Dimensions reference the finished body.",
      2.65,
    ),
    label(
      13,
      177,
      tolerance
        ? "General linear tolerance: ± " + tolerance + " mm."
        : "See following sheet for measured dimensions and feature callouts.",
      2.45,
    ),
  );
  const sheets: TechSheet[] = [
    {
      label: "Views and section",
      sheet: { width: 297, height: 210, marks: m },
    },
  ];
  if (options.detail) {
    const width = options.detail.width,
      end = options.detail.end === "end",
      lo = views.section.bounds[0][0],
      hi = views.section.bounds[1][0];
    if (!(width > 0 && width <= hi - lo + 1e-6))
      throw Error(
        "Set the detail width above zero and no longer than the section.",
      );
    const a = end ? hi - width : lo,
      b = end ? hi : lo + width,
      d = clippedView(views.section, a, b);
    if (!d.paths.length)
      throw Error(
        "The selected detail region does not intersect this section.",
      );
    const [ww, hh] = viewSize(d),
      max = Math.min(244 / ww, 83 / (hh || 1)),
      mag =
        [100, 50, 25, 20, 10, 5, 4, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.01].find(
          (v) => v <= max,
        ) ?? max;
    const midpoint = (hi + lo) / 2;
    const x1 = 143 + (a - midpoint) * scale,
      x2 = 143 + (b - midpoint) * scale;
    const bracketY = 147 + (viewSize(views.section)[1] * scale) / 2 + 2.1;
    m.push(
      path(
        [
          [x1, bracketY - 1],
          [x1, bracketY],
          [x2, bracketY],
          [x2, bracketY - 1],
        ],
        "Detail_locator",
        0.18,
      ),
      label(
        (x1 + x2) / 2,
        bracketY + 2.7,
        "B",
        2.2,
        "middle",
        "Detail_locator",
      ),
    );
    const detail = sheetFrame(
      c,
      fmtScale(mag),
      2,
      total,
      "SECTION DETAIL · FINISHED BODY",
    );
    detail.push(
      label(14, 32, "Detail of " + (end ? "far" : "start") + " end · B", 4.5),
      label(
        14,
        41,
        "Section A–A, horizontal interval " +
          n(a - lo) +
          " … " +
          n(b - lo) +
          " mm from section start.",
        2.8,
      ),
    );
    if (c.hatch) {
      const midY = (d.bounds[0][1] + d.bounds[1][1]) / 2;
      const toPage = ([x, y]: XY): XY => [
        148.5 + (x - (a + b) / 2) * mag,
        107 - (y - midY) * mag,
      ];
      hatchContours(
        detail,
        views.section.paths.map((edge) => edge.map(toPage)),
        [toPage([a, d.bounds[1][1]]), toPage([b, d.bounds[0][1]])],
      );
    }
    placeView(detail, d, 148.5, 107, mag);
    if (c.dimensions)
      tickDimension(
        detail,
        [148.5 - (ww * mag) / 2, 164],
        [148.5 + (ww * mag) / 2, 164],
        formatDrawingLength(ww),
      );
    sheets.push({
      label: "Section detail",
      scale: mag,
      sheet: { width: 297, height: 210, marks: detail },
    });
  }
  for (let k = 0; k < additional; k++) {
    const m = sheetFrame(
      c,
      "—",
      k + 2 + extra,
      total,
      "FINISHED BODY DIMENSIONS",
    );
    m.push(
      label(14, 31, "Dimensions and feature callouts", 5),
      label(
        14,
        38,
        "Axial surface stations are measured from the left end of the final solid. Dimensions in millimetres.",
        2.8,
      ),
    );
    m.push(
      line(13, 44, 284, 44, "Border", 0.25),
      label(15, 49, "DESCRIPTION", 2.45),
      label(99, 49, "VALUE", 2.45),
      label(198, 49, "AXIAL RANGE / UNITS", 2.45),
    );
    rows
      .slice(k * rowCount, (k + 1) * rowCount)
      .forEach(([what, value, detail], i) => {
        const y = 57 + i * 6.7;
        m.push(
          line(13, y - 5, 284, y - 5, "Border", 0.1),
          label(
            15,
            y,
            what === "Form control" ? "Specified form tolerance" : what,
            2.85,
          ),
          label(198, y, detail, 2.85),
        );
        if (what === "Form control") {
          m.push(
            path(
              [
                [99, y - 3.5],
                [121, y - 3.5],
                [121, y + 1],
                [99, y + 1],
              ],
              "GD_and_T",
              0.23,
              true,
            ),
            line(105, y - 3.5, 105, y + 1, "GD_and_T", 0.2),
            label(107, y, value.split("|")[1], 2.85),
          );
          if (value.startsWith("ROUNDNESS"))
            m.push(circle(102, y - 1.25, 1.25, "GD_and_T"));
          else m.push(line(100.4, y - 1.25, 103.6, y - 1.25, "GD_and_T", 0.25));
        } else if (what === "Datum feature") {
          m.push(
            path(
              [
                [100, y - 3.6],
                [106, y - 3.6],
                [106, y + 1.3],
                [100, y + 1.3],
              ],
              "GD_and_T",
              0.25,
              true,
            ),
            label(103, y, value, 2.9, "middle", "GD_and_T"),
            line(106, y - 1.2, 113, y - 1.2, "GD_and_T", 0.22),
          );
          const triangle = path(
            [
              [113, y - 1.2],
              [116, y - 2.6],
              [116, y + 0.2],
            ],
            "GD_and_T",
            0.2,
            true,
          );
          triangle.fill = true;
          m.push(
            triangle,
            line(116, y - 3.4, 116, y + 1.1, "GD_and_T", 0.22),
            label(119, y, "Cylindrical feature", 2.65),
          );
        } else
          m.push(label(99, y, value, what === "Feature callout" ? 2.4 : 2.85));
      });
    sheets.push({
      label:
        additional === 1 ? "Dimensions and callouts" : "Dimensions " + (k + 1),
      sheet: { width: 297, height: 210, marks: m },
    });
  }
  appendDimensionSheets(
    sheets,
    views,
    c,
    tolerance,
    options.manualDimensions || [],
    total,
  );
  return { sheets, scale };
}

export function dimensionViewCount(dimensions: MeasuredDimension[]) {
  return dimensionViewNames.filter((view) =>
    dimensions.some((d) => d.spec.view === view),
  ).length;
}
export function appendDimensionSheets(
  sheets: TechSheet[],
  views: DimensionGeometry,
  c: DrawingData,
  tolerance: string,
  dimensions: MeasuredDimension[],
  total: number,
  titleField = "PART",
) {
  for (const view of dimensionViewNames) {
    const onView = dimensions.filter((d) => d.spec.view === view);
    if (!onView.length) continue;
    const geometry = views[view];
    if (!geometry)
      throw Error(
        "A dimension needs section A–A. Enable the assembly section or choose a new view for that dimension.",
      );
    const layout = dimensionLayout(geometry, c.scale);
    const marks = sheetFrame(
      c,
      fmtScale(layout.scale),
      sheets.length + 1,
      total,
      "THIRD-ANGLE PROJECTION · DIMENSIONS IN mm",
      titleField,
    );
    const name = dimensionSheetName(view);
    marks.push(label(14, 28, name, 4.2));
    placeView(
      marks,
      geometry,
      148.5,
      102,
      layout.scale,
      view === "section" && titleField === "PART" && c.hatch,
    );
    for (const dimension of onView) {
      marks.push(...dimensionMarks(dimension, layout.at));
    }
    if (tolerance)
      marks.push(
        label(
          13,
          178,
          "Unless individually specified, linear tolerance ± " +
            tolerance +
            " mm.",
          2.45,
        ),
      );
    sheets.push({
      label: name,
      scale: layout.scale,
      sheet: { width: 297, height: 210, marks },
    });
  }
}
