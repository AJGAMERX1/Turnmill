import type { EvaluatedFeature } from "./types";
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
export type Measure = { a: number; b: number; keyA: string; keyB: string };
export type DrawingData = {
  title: string;
  number: string;
  revision: string;
  material: string;
  note: string;
  scale: "auto" | number;
  dimensions: boolean;
  hatch: boolean;
  measures: Measure[];
};
function hatchPoly(poly: XY[]) {
  const lines: Mark[] = [];
  const heights = poly.map(([x, y]) => y - x);
  for (
    let q = Math.ceil(Math.min(...heights) / 2.8) * 2.8;
    q < Math.max(...heights);
    q += 2.8
  ) {
    const hits: XY[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        u = a[1] - a[0],
        v = b[1] - b[0];
      if (!((u <= q && q < v) || (v <= q && q < u))) continue;
      const t = (q - u) / (v - u);
      hits.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < hits.length; i += 2)
      lines.push(path([hits[i], hits[i + 1]], "Section_hatch", 0.12));
  }
  return lines;
}
function dimension(
  marks: Mark[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  text: string,
  vertical = false,
) {
  marks.push(line(x1, y1, x2, y2, "Dimensions", 0.18));
  for (const [x, y] of [
    [x1, y1],
    [x2, y2],
  ])
    marks.push(
      line(x - 1.05, y + 1.05, x + 1.05, y - 1.05, "Dimensions", 0.27),
    );
  const t = label(
    (x1 + x2) / 2,
    (y1 + y2) / 2 - 1.6,
    text,
    2.8,
    "middle",
    "Dimensions",
  );
  if (vertical) {
    t.x -= 1.4;
    t.y += 1.6;
    t.rotation = -90;
  }
  marks.push(t);
}
function center(marks: Mark[], a: XY, b: XY) {
  const [ax, ay] = a,
    [bx, by] = b,
    dx = bx - ax,
    dy = by - ay,
    dist = Math.hypot(dx, dy);
  for (let start = 0; start < dist; start += 9)
    for (const [from, to] of [
      [start, start + 5.5],
      [start + 6.7, start + 7.6],
    ]) {
      if (from >= dist) continue;
      marks.push(
        line(
          ax + (dx * from) / dist,
          ay + (dy * from) / dist,
          ax + (dx * Math.min(dist, to)) / dist,
          ay + (dy * Math.min(dist, to)) / dist,
          "Centre_lines",
          0.12,
        ),
      );
    }
}
export function makeDrawing(
  f: EvaluatedFeature,
  c: DrawingData,
): { sheet: Sheet; scale: number } {
  const p = f.points,
    xs = p.map((v) => v[0]),
    ys = p.map((v) => v[1]);
  if (f.edges?.some((edge) => edge.through))
    throw Error(
      "This sheet currently supports straight-sided profiles. Curved sketch edges need exact projected views before export.",
    );
  if (p.length < 3)
    throw Error(
      "Close a profile with at least three points to prepare a drawing.",
    );
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const revolve = f.kind === "revolve";
  if (revolve && Math.abs(Math.abs(f.amount) - 360) > 1e-7)
    throw Error(
      "This section sheet supports full 360° revolves. Select a full revolve or an extrusion.",
    );
  const r = Math.max(Math.abs(minY), Math.abs(maxY)),
    ri = minY * maxY <= 0 ? 0 : Math.min(Math.abs(minY), Math.abs(maxY));
  const w = maxX - minX,
    h = revolve ? 2 * r : maxY - minY,
    thick = Math.abs(f.amount);
  if (!(w > 0 && h > 0))
    throw Error("This profile has no drawable area. Check its dimensions.");
  const maxScale = Math.min(
    183 / w,
    61 / h,
    revolve ? 50 / h : Math.min(47 / w, 38 / thick),
  );
  const preferred = [
    10, 5, 4, 2, 1, 0.5, 0.25, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.001,
  ];
  const scale =
    c.scale === "auto"
      ? (preferred.find((v) => v <= maxScale) ?? maxScale)
      : c.scale;
  if (!Number.isFinite(scale) || scale <= 0 || scale > maxScale + 1e-6)
    throw Error(
      "The part exceeds this sheet at the selected scale. Select Fit to sheet or a smaller scale.",
    );
  const marks: Mark[] = [
    path(
      [
        [7, 7],
        [290, 7],
        [290, 203],
        [7, 203],
      ],
      "Border",
      0.38,
      true,
    ),
  ];
  const x0 = 112 - (w * scale) / 2,
    y0 = 82;
  const X = (x: number) => x0 + (x - minX) * scale;
  const Y = (y: number) => y0 - (y - (revolve ? 0 : (minY + maxY) / 2)) * scale;
  const project = (pt: XY): XY => [X(pt[0]), Y(pt[1])];
  const outline = p.map(project);
  const drawProfile = (pts: XY[]) => {
    if (c.hatch && revolve) marks.push(...hatchPoly(pts));
    marks.push(path(pts, "Outline", 0.42, true));
  };
  drawProfile(outline);
  if (revolve) {
    drawProfile(p.map(([x, y]) => [X(x), Y(-y)]));
    center(marks, [x0 - 7, y0], [x0 + w * scale + 7, y0]);
  }
  marks.push(
    label(15, 18, "TURNMILL", 3.3),
    label(281, 18, "BASE FEATURE DETAIL", 2.8, "end"),
  );
  marks.push(
    label(
      112,
      34,
      revolve ? "LONGITUDINAL SECTION" : "PROFILE VIEW",
      3.1,
      "middle",
    ),
    label(248, 34, revolve ? "END PROJECTION" : "SIDE VIEW", 3.1, "middle"),
  );
  if (revolve) {
    marks.push(circle(248, y0, r * scale));
    if (ri > 0) marks.push(circle(248, y0, ri * scale));
    center(marks, [248 - r * scale - 4, y0], [248 + r * scale + 4, y0]);
    center(marks, [248, y0 - r * scale - 4], [248, y0 + r * scale + 4]);
  } else {
    const l = 248 - (w * scale) / 2,
      t = y0 - (thick * scale) / 2;
    marks.push(
      path(
        [
          [l, t],
          [l + w * scale, t],
          [l + w * scale, t + thick * scale],
          [l, t + thick * scale],
        ],
        "Outline",
        0.4,
        true,
      ),
    );
    if (c.dimensions) {
      const x = l + w * scale + 6;
      marks.push(
        line(x - 7, t, x + 1, t, "Dimensions", 0.16),
        line(
          x - 7,
          t + thick * scale,
          x + 1,
          t + thick * scale,
          "Dimensions",
          0.16,
        ),
      );
      dimension(marks, x, t, x, t + thick * scale, n(thick), true);
    }
  }
  if (c.dimensions) {
    const dY = y0 + (h * scale) / 2 + 10,
      xRight = x0 + w * scale,
      dX = x0 - 6;
    marks.push(
      line(x0, y0 + (h * scale) / 2 + 1, x0, dY + 2, "Dimensions", 0.17),
      line(
        xRight,
        y0 + (h * scale) / 2 + 1,
        xRight,
        dY + 2,
        "Dimensions",
        0.17,
      ),
    );
    dimension(marks, x0, dY, xRight, dY, n(w));
    marks.push(
      line(
        dX - 2,
        y0 - (h * scale) / 2,
        x0 - 1,
        y0 - (h * scale) / 2,
        "Dimensions",
        0.17,
      ),
      line(
        dX - 2,
        y0 + (h * scale) / 2,
        x0 - 1,
        y0 + (h * scale) / 2,
        "Dimensions",
        0.17,
      ),
    );
    dimension(
      marks,
      dX,
      y0 - (h * scale) / 2,
      dX,
      y0 + (h * scale) / 2,
      (revolve ? "Ø " : "") + n(h),
      true,
    );
    if (revolve && ri > 0) {
      const leader: XY = [248 - ri * scale * 0.707, y0 + ri * scale * 0.707];
      marks.push(
        path([leader, [230, 121], [218, 121]], "Dimensions", 0.17),
        label(218, 119.8, "Ø " + n(2 * ri), 2.8),
      );
    }
  }
  marks.push(
    line(7, 141, 290, 141, "Border", 0.22),
    label(13, 149, "FEATURE DIMENSIONS", 2.55),
    label(281, 149, ("Source: " + f.name).slice(0, 53), 2.4, "end"),
  );
  if (c.measures.length) {
    c.measures.forEach(({ a, b }, i) => {
      const aa = p[a],
        bb = p[b];
      if (!aa || !bb) return;
      const col = i % 3,
        row = Math.floor(i / 3);
      marks.push(
        label(
          13 + col * 86,
          156 + row * 4.4,
          `[${i + 1}]  P${a + 1} to P${b + 1}   ${n(Math.hypot(aa[0] - bb[0], aa[1] - bb[1]))} mm`,
          2.6,
        ),
      );
      for (const [idx, pt] of [
        [a, aa],
        [b, bb],
      ] as [number, XY][]) {
        const [px, py] = project(pt);
        if (
          !marks.some(
            (m) =>
              m.type === "text" &&
              m.layer === "Point_ids" &&
              m.value === "P" + (idx + 1),
          )
        )
          marks.push(
            label(px, py - 1.2, "P" + (idx + 1), 2.2, "middle", "Point_ids"),
          );
      }
    });
  } else marks.push(label(13, 157, "All dimensions in millimetres.", 2.8));
  if (c.note) marks.push(label(13, 171, c.note.slice(0, 84), 2.6));
  marks.push(
    line(7, 178, 290, 178, "Border"),
    line(179, 178, 179, 203, "Border"),
    line(227, 178, 227, 203, "Border"),
    line(260, 178, 260, 203, "Border"),
  );
  marks.push(
    label(13, 185, "PART / FEATURE", 2.5),
    label(13, 195, c.title.slice(0, 55), 4.3),
    label(182, 185, "DRAWING NO.", 2.4),
    label(182, 194, c.number.slice(0, 24), 2.95),
  );
  marks.push(
    label(230, 185, "SCALE", 2.4),
    label(230, 194, scale >= 1 ? n(scale) + ":1" : "1:" + n(1 / scale), 3.1),
    label(263, 185, "REVISION", 2.4),
    label(263, 194, c.revision.slice(0, 12), 3),
  );
  if (c.material)
    marks.push(label(13, 200, "Material: " + c.material.slice(0, 48), 2.55));
  return { sheet: { width: 297, height: 210, marks }, scale };
}
