import { isCadFont, numeralInk } from "./secondaryInk";
import {
  label,
  n,
  path,
  type Sheet,
  type Mark,
  type XY,
} from "./secondaryVector";
export const scaleUnits = {
  mm: "Millimetres",
  cm: "Centimetres",
  in8: "Inch · 1/8",
  in16: "Inch · 1/16",
  in32: "Inch · 1/32",
  ind: "Inch · decimal",
  custom: "Custom linear scale",
  architectural: "Architectural · metres",
};
export type ScaleUnit = keyof typeof scaleUnits;
export type ScaleLayout = {
  length: number;
  width: number;
  offset: number;
  major: number;
  mid: number;
  minor: number;
  weight: number;
  fontSize: number;
  font: string;
  rotation: number;
  frequency: number;
  top: ScaleUnit;
  bottom: ScaleUnit | "off";
  customStep: number;
  customRatio: number;
  labelGap: number;
  layout: "linear" | "arc";
  angleStep: number;
  angleSpan: number;
  majorWeight?: number;
  midWeight?: number;
  architectureRatio?: number;
  bottomLabels?: ScaleLabelStyle;
};
export type ScaleLabelStyle = {
  font: string;
  fontSize: number;
  frequency: number;
  rotation: number;
  labelGap: number;
};
export function makeScale(c: ScaleLayout): {
  geometry: Sheet;
  preview: Sheet;
  count: number;
} {
  if (
    Object.values(c).some((v) => typeof v === "number" && !Number.isFinite(v))
  )
    throw Error("Check scale fields for a non-finite value.");
  if (c.length <= 0 || c.width <= 0 || c.offset < 0 || c.offset >= c.length)
    throw Error(
      "Set a positive stock length and width, with a start offset inside the stock.",
    );
  if (
    c.minor <= 0 ||
    c.mid < c.minor ||
    c.major < c.mid ||
    c.weight <= 0 ||
    c.fontSize <= 0 ||
    c.frequency < 1 ||
    !Number.isInteger(c.frequency) ||
    c.labelGap < 0
  )
    throw Error(
      "Use positive tick lengths in increasing order, positive line width and type size, and a whole label frequency.",
    );
  if (
    !Object.hasOwn(scaleUnits, c.top) ||
    (c.bottom !== "off" && !Object.hasOwn(scaleUnits, c.bottom))
  )
    throw Error("Select a supported graduation unit for each edge.");
  if ((c.majorWeight ?? c.weight) <= 0 || (c.midWeight ?? c.weight) <= 0)
    throw Error("Use positive widths for each graduation rank.");
  if (
    c.bottomLabels &&
    (c.bottomLabels.fontSize <= 0 ||
      c.bottomLabels.labelGap < 0 ||
      c.bottomLabels.frequency < 1 ||
      !Number.isInteger(c.bottomLabels.frequency))
  )
    throw Error(
      "Use a positive lower label size and a whole-number frequency.",
    );
  const marks: Mark[] = [],
    stock: Mark[] = [];
  let count = 0;
  const height = c.layout === "arc" ? c.length / 2 : c.width;
  const text = (
    x: number,
    y: number,
    v: string,
    style: ScaleLabelStyle,
    anchor: "start" | "end" | "middle" = "middle",
  ) => {
    const t = label(x, y, v, style.fontSize, anchor, "Labels");
    t.rotation = style.rotation;
    t.font = style.font;
    if (isCadFont(style.font))
      t.ink = numeralInk(
        v,
        x,
        y,
        style.fontSize,
        anchor,
        style.rotation,
        style.font,
      );
    marks.push(t);
  };
  const add = (a: XY, b: XY, major: boolean, mid: boolean) => {
    marks.push(
      path(
        [a, b],
        "Graduations",
        (major ? c.majorWeight : mid ? c.midWeight : c.weight) ?? c.weight,
      ),
    );
    count++;
  };
  if (c.layout === "linear") {
    if (
      c.major +
        c.fontSize +
        c.labelGap +
        (c.bottom === "off"
          ? 0
          : c.major +
            (c.bottomLabels ?? c).fontSize +
            (c.bottomLabels ?? c).labelGap) >
      c.width
    )
      throw Error(
        "The graduations overlap. Increase the stock width or shorten the ticks and labels.",
      );
    stock.push(
      path(
        [
          [0, 0],
          [c.length, 0],
          [c.length, c.width],
          [0, c.width],
        ],
        "Stock",
        0.23,
        true,
      ),
    );
    function edge(u: ScaleUnit, bottom: boolean) {
      const style = bottom ? (c.bottomLabels ?? c) : c;
      const Y = bottom ? c.width : 0,
        inward = bottom ? -1 : 1;
      const sub = u === "in8" ? 8 : u === "in16" ? 16 : u === "in32" ? 32 : 10;
      const step =
        u === "architectural"
          ? 100 / (c.architectureRatio ?? 50)
          : u === "custom"
            ? c.customStep
            : u.startsWith("in")
              ? 25.4 / sub
              : 1;
      if (
        !(
          step > 0 &&
          (u !== "custom" || c.customRatio > 0) &&
          Number.isFinite(step)
        )
      )
        throw Error("Set a positive minor spacing and custom scale ratio.");
      const total = Math.floor((c.length - c.offset) / step + 1e-9);
      if (total > 5000)
        throw Error(
          "This edge exceeds 5,000 ticks. Increase minor spacing or shorten the ruler.",
        );
      for (let i = 0; i <= total; i++) {
        const x = c.offset + i * step,
          major = i % sub === 0,
          mid = i % (sub / 2) === 0;
        add(
          [x, Y],
          [x, Y + inward * (major ? c.major : mid ? c.mid : c.minor)],
          major,
          mid,
        );
        if (major && (i / sub) % style.frequency === 0) {
          const value =
            u === "mm"
              ? i * step
              : u === "cm"
                ? (i * step) / 10
                : u === "custom"
                  ? i * step * c.customRatio
                  : i / sub;
          const txt = n(value);
          const inset = style.fontSize * 0.35;
          // Align labels at the ends toward the inside of the stock.
          const anchor =
            x < (style.fontSize * txt.length) / 2 + inset
              ? "start"
              : c.length - x < (style.fontSize * txt.length) / 2 + inset
                ? "end"
                : "middle";
          const xx =
            anchor === "start"
              ? Math.max(x, inset)
              : anchor === "end"
                ? Math.min(x, c.length - inset)
                : x;
          text(
            xx,
            Y +
              inward * (c.major + style.labelGap) +
              (bottom ? 0 : style.fontSize * 0.72),
            txt,
            style,
            anchor,
          );
        }
      }
    }
    edge(c.top, false);
    if (c.bottom !== "off") edge(c.bottom, true);
  } else {
    const r = c.length / 2,
      cx = r,
      cy = r;
    if (
      c.angleStep <= 0 ||
      c.angleStep > 180 ||
      c.angleSpan <= 0 ||
      c.angleSpan > 180 ||
      c.major + c.fontSize + c.labelGap >= r
    )
      throw Error(
        "Choose a positive angular interval with a span through 180°, and keep ticks and labels within the radius.",
      );
    if (c.angleSpan / c.angleStep > 5000)
      throw Error(
        "Increase the angle interval to keep the arc below 5,000 ticks.",
      );
    if (c.offset >= r)
      throw Error("Start inset must be smaller than the protractor radius.");
    const radius = r - c.offset;
    if (c.major + c.fontSize + c.labelGap >= radius)
      throw Error(
        "Reduce the inset, tick lengths, or type size to keep the labels inside the arc.",
      );
    const polar = (rr: number, deg: number): XY => [
      cx - rr * Math.cos((deg * Math.PI) / 180),
      cy - rr * Math.sin((deg * Math.PI) / 180),
    ];
    const perimeter: XY[] = [];
    for (let i = 0; i <= 180; i++) perimeter.push(polar(r, i));
    stock.push({
      ...path(perimeter, "Stock", 0.23, true),
      upperSemicircle: { x: cx, y: cy, radius: r },
    });
    for (let i = 0; i <= Math.floor(c.angleSpan / c.angleStep + 1e-9); i++) {
      const angle = i * c.angleStep,
        major = i % 10 === 0,
        mid = i % 5 === 0;
      add(
        polar(radius, angle),
        polar(radius - (major ? c.major : mid ? c.mid : c.minor), angle),
        major,
        mid,
      );
      if (major && (i / 10) % c.frequency === 0) {
        const [x, y] = polar(
          radius - c.major - c.labelGap - c.fontSize * 0.6,
          angle,
        );
        text(x, Math.min(cy - 0.3, y + c.fontSize * 0.29), n(angle) + "°", c);
      }
    }
  }
  return {
    geometry: { width: c.length, height, marks },
    preview: { width: c.length, height, marks: [...stock, ...marks] },
    count,
  };
}

// Width-accurate contours are shared by the export and the solid cutters.
// Coordinates are in sheet space (origin at the upper-left).
export function tickContour(
  mark: Extract<Mark, { type: "path" }>,
  c: ScaleLayout,
): XY[] {
  const [a, b] = mark.pts;
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy);
  const half = (mark.weight ?? c.weight) / 2,
    ux = dx / length,
    uy = dy / length;
  let from: XY = a;
  if (c.layout === "arc") {
    const r = c.length / 2;
    if (half >= r)
      throw Error("Reduce tick width below the protractor diameter.");
    const inset = Math.max(
      0,
      Math.hypot(a[0] - r, a[1] - r) - Math.sqrt(r * r - half * half),
    );
    if (inset >= length - 1e-8)
      throw Error(
        "This tick is too wide for the protractor rim. Reduce its width or increase its length.",
      );
    from = [a[0] + ux * inset, a[1] + uy * inset];
  }
  let polygon: XY[] = [
    [from[0] - uy * half, from[1] + ux * half],
    [from[0] + uy * half, from[1] - ux * half],
    [b[0] + uy * half, b[1] - ux * half],
    [b[0] - uy * half, b[1] + ux * half],
  ];
  if (c.layout === "linear")
    polygon = polygon.map(([x, y]) => [Math.max(0, Math.min(c.length, x)), y]);
  else {
    const baseline = c.length / 2,
      clipped: XY[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length];
      if (p[1] <= baseline) clipped.push(p);
      if (
        (p[1] < baseline && q[1] > baseline) ||
        (p[1] > baseline && q[1] < baseline)
      ) {
        const t = (baseline - p[1]) / (q[1] - p[1]);
        clipped.push([p[0] + (q[0] - p[0]) * t, baseline]);
      }
    }
    polygon = clipped;
  }
  return polygon;
}
export function outlinedGraduations(sheet: Sheet, layout: ScaleLayout): Sheet {
  return {
    ...sheet,
    marks: sheet.marks.map((m) =>
      m.type === "path" && m.layer === "Graduations"
        ? {
            ...path(tickContour(m, layout), "Graduation_outlines", 0, true),
            fill: true,
          }
        : m,
    ),
  };
}
