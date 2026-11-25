import { useEffect, useState } from "react";
import type { Project, EvaluatedFeature } from "./types";
import type { Artwork } from "./markArtwork";
import { flattenInk, inkPath } from "./secondaryInk";
import { evaluate } from "./expressions";
import "./secondary.css";

export type WorkspaceProps = {
  project: Project;
  values: Record<string, number>;
  features: EvaluatedFeature[];
  onChange: (project: Project) => void;
};
export type XY = [number, number];
type Style = { layer?: string; weight?: number; color?: string };
type Path = Style & {
  type: "path";
  pts: XY[];
  upperSemicircle?: { x: number; y: number; radius: number };
  close?: boolean;
  fill?: boolean;
};
type Circle = Style & { type: "circle"; x: number; y: number; radius: number };
type Label = Style & {
  type: "text";
  x: number;
  y: number;
  value: string;
  size: number;
  anchor?: "start" | "middle" | "end";
  rotation?: number;
  font?: string;
  ink?: Artwork["outlines"];
};
export type Mark = Path | Circle | Label;
export type Sheet = {
  width: number;
  height: number;
  marks: Mark[];
  svgBounds?: [number, number, number, number];
};
export const path = (
  pts: XY[],
  layer = "Outline",
  weight = 0.3,
  close = false,
): Path => ({ type: "path", pts, layer, weight, close });
export const line = (
  x: number,
  y: number,
  xx: number,
  yy: number,
  layer = "Outline",
  weight = 0.3,
) =>
  path(
    [
      [x, y],
      [xx, yy],
    ],
    layer,
    weight,
  );
export const label = (
  x: number,
  y: number,
  value: string,
  size = 3,
  anchor: Label["anchor"] = "start",
  layer = "Text",
): Label => ({ type: "text", x, y, value, size, anchor, layer });
export const circle = (
  x: number,
  y: number,
  radius: number,
  layer = "Outline",
): Circle => ({ type: "circle", x, y, radius, layer, weight: 0.3 });
export const n = (value: number, digits = 3) =>
  String(Number(value.toFixed(digits)));
export const fileName = (value: string) =>
  value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|[-.]+$/g, "") || "turnmill";
export function saveAs(data: BlobPart, mime: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function changeWorkspace(
  props: WorkspaceProps,
  key: string,
  patch: Record<string, unknown>,
) {
  const prev = props.project.workspaces || {};
  props.onChange({
    ...props.project,
    workspaces: { ...prev, [key]: { ...prev[key], ...patch } },
  });
}
export function NumberField({
  title,
  expr,
  values,
  kind = "length",
  valid,
  rangeHint,
  onCommit,
  unit,
}: {
  title: string;
  expr: string;
  values: Record<string, number>;
  kind?: "length" | "angle" | "scalar";
  valid?: (value: number) => boolean;
  rangeHint?: string;
  onCommit: (expr: string) => void;
  unit?: string;
}) {
  const [draft, setDraft] = useState(expr);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(expr);
    setError("");
  }, [expr]);
  function commit() {
    if (draft === expr && !error) return;
    try {
      const value = evaluate(draft, values, kind);
      if (!Number.isFinite(value) || (valid && !valid(value)))
        throw Error(rangeHint || "Enter a value within the allowed range.");
      setError("");
      if (draft !== expr) onCommit(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the expression.");
    }
  }
  return (
    <label className="tm-field">
      <span>{title}</span>
      <span className="tm-number">
        <input
          aria-label={title}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(expr);
              setError("");
            }
          }}
        />
        {unit &&
          !/(?:mm|cm|µm|um|in|deg|rad|inches|inch|ft|°)\s*$/.test(draft) && (
            <small>{unit}</small>
          )}
      </span>
      {error && <em role="alert">{error}</em>}
    </label>
  );
}
export function TextField({
  title,
  value,
  onCommit,
}: {
  title: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, set] = useState(value);
  useEffect(() => set(value), [value]);
  return (
    <label className="tm-field">
      <span>{title}</span>
      <input
        aria-label={title}
        value={draft}
        maxLength={90}
        onChange={(e) => set(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
const ink = "#223133";
export function semicirclePath({
  x,
  y,
  radius: r,
}: NonNullable<Path["upperSemicircle"]>) {
  return `M${x - r} ${y}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}
export function VectorMark({ m }: { m: Mark }) {
  if (m.type === "text" && m.ink)
    return <path d={inkPath(m.ink)} fill={m.color || ink} fillRule="evenodd" />;
  if (m.type === "text")
    return (
      <text
        x={m.x}
        y={m.y}
        fontSize={m.size}
        fill={m.color || ink}
        textAnchor={m.anchor || "start"}
        fontFamily={m.font || "Helvetica, Arial, sans-serif"}
        transform={
          m.rotation ? `rotate(${m.rotation} ${m.x} ${m.y})` : undefined
        }
      >
        {m.value}
      </text>
    );
  const attrs = {
    fill: m.type === "path" && m.fill ? m.color || ink : "none",
    stroke: m.weight === 0 ? "none" : m.color || ink,
    strokeWidth: m.weight ?? 0.25,
    strokeLinejoin: "round" as const,
  };
  if (m.type === "circle")
    return <circle {...attrs} cx={m.x} cy={m.y} r={m.radius} />;
  if (m.upperSemicircle)
    return <path {...attrs} d={semicirclePath(m.upperSemicircle)} />;
  const pts = m.pts.map((p) => p.join(",")).join(" ");
  return m.close ? (
    <polygon {...attrs} points={pts} />
  ) : (
    <polyline {...attrs} points={pts} />
  );
}
export function SheetView({ sheet, name }: { sheet: Sheet; name: string }) {
  return (
    <svg
      className="tm-sheet"
      role="img"
      aria-label={name}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${sheet.width} ${sheet.height}`}
    >
      <title>{name}</title>
      {sheet.marks.map((m, i) => (
        <VectorMark key={i} m={m} />
      ))}
    </svg>
  );
}
function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
export function svgFile(sheet: Sheet) {
  const contents = sheet.marks.map((m) => {
    const color = esc(m.color || ink);
    const layer = 'data-layer="' + esc(m.layer || "Outline") + '"';
    if (m.type === "text" && m.ink)
      return `<path ${layer} d="${inkPath(m.ink)}" fill="${color}" fill-rule="evenodd"/>`;
    if (m.type === "text")
      return `<text ${layer} x="${m.x}" y="${m.y}" font-size="${m.size}" text-anchor="${m.anchor || "start"}" font-family="${esc(m.font || "Helvetica, Arial, sans-serif")}" transform="rotate(${m.rotation || 0} ${m.x} ${m.y})" fill="${color}">${esc(m.value)}</text>`;
    const attribs = `${layer} fill="${m.type === "path" && m.fill ? color : "none"}" stroke="${m.weight === 0 ? "none" : color}" stroke-width="${m.weight ?? 0.25}" stroke-linejoin="round"`;
    if (m.type === "circle")
      return `<circle cx="${m.x}" cy="${m.y}" r="${m.radius}" ${attribs}/>`;
    if (m.upperSemicircle)
      return `<path d="${semicirclePath(m.upperSemicircle)}" ${attribs}/>`;
    const tag = m.close ? "polygon" : "polyline";
    return `<${tag} points="${m.pts.map((p) => p.join(",")).join(" ")}" ${attribs}/>`;
  });
  const [x, y, right, bottom] = sheet.svgBounds ?? [
    0,
    0,
    sheet.width,
    sheet.height,
  ];
  const width = right - x,
    height = bottom - y;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${x} ${y} ${width} ${height}">${contents.join("\n")}</svg>`;
}
export function dxfFile(sheet: Sheet) {
  // DXF coordinates are millimetres, Y up. SVG text size is an em, DXF height is cap height.
  const layers = new Set([
    "0",
    ...sheet.marks.map((m) => m.layer || "Outline"),
  ]);
  let handle = 0x20;
  const nextHandle = () => (handle++).toString(16).toUpperCase();
  const records: (string | number)[] = [
    0,
    "SECTION",
    2,
    "HEADER",
    9,
    "$ACADVER",
    1,
    "AC1015",
    9,
    "$INSUNITS",
    70,
    4,
    0,
    "ENDSEC",
    0,
    "SECTION",
    2,
    "TABLES",
  ];
  const table = (name: string, id: string, count: number) =>
    records.push(
      0,
      "TABLE",
      2,
      name,
      5,
      id,
      330,
      "0",
      100,
      "AcDbSymbolTable",
      70,
      count,
    );
  table("LTYPE", "1", 1);
  records.push(
    0,
    "LTYPE",
    5,
    "2",
    330,
    "1",
    100,
    "AcDbSymbolTableRecord",
    100,
    "AcDbLinetypeTableRecord",
    2,
    "CONTINUOUS",
    70,
    0,
    3,
    "Solid line",
    72,
    65,
    73,
    0,
    40,
    0,
    0,
    "ENDTAB",
  );
  table("LAYER", "3", layers.size);
  for (const layer of layers)
    records.push(
      0,
      "LAYER",
      5,
      nextHandle(),
      330,
      "3",
      100,
      "AcDbSymbolTableRecord",
      100,
      "AcDbLayerTableRecord",
      2,
      layer,
      70,
      0,
      62,
      7,
      6,
      "CONTINUOUS",
    );
  records.push(0, "ENDTAB");
  table("BLOCK_RECORD", "4", 2);
  for (const [id, name] of [
    ["5", "*Model_Space"],
    ["6", "*Paper_Space"],
  ])
    records.push(
      0,
      "BLOCK_RECORD",
      5,
      id,
      330,
      "4",
      100,
      "AcDbSymbolTableRecord",
      100,
      "AcDbBlockTableRecord",
      2,
      name,
    );
  records.push(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "BLOCKS");
  for (const [id, name] of [
    ["5", "*Model_Space"],
    ["6", "*Paper_Space"],
  ]) {
    records.push(
      0,
      "BLOCK",
      5,
      nextHandle(),
      330,
      id,
      100,
      "AcDbEntity",
      8,
      "0",
      100,
      "AcDbBlockBegin",
      2,
      name,
      70,
      0,
      10,
      0,
      20,
      0,
      30,
      0,
      3,
      name,
      1,
      "",
    );
    records.push(
      0,
      "ENDBLK",
      5,
      nextHandle(),
      330,
      id,
      100,
      "AcDbEntity",
      8,
      "0",
      100,
      "AcDbBlockEnd",
    );
  }
  records.push(0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  const entity = (kind: string, layer: string, subclass: string) =>
    records.push(
      0,
      kind,
      5,
      nextHandle(),
      330,
      "5",
      100,
      "AcDbEntity",
      8,
      layer,
      100,
      subclass,
    );
  for (const m of sheet.marks) {
    const layer = m.layer || "Outline";
    if (m.type === "text" && m.ink) {
      for (const glyph of m.ink)
        for (const outline of [glyph.outer, ...glyph.holes]) {
          const points = flattenInk(outline);
          entity("LWPOLYLINE", layer, "AcDbPolyline");
          records.push(90, points.length, 70, 1);
          for (const [x, y] of points)
            records.push(10, x, 20, sheet.height - y);
        }
    } else if (m.type === "text") {
      const align = m.anchor === "middle" ? 1 : m.anchor === "end" ? 2 : 0;
      entity("TEXT", layer, "AcDbText");
      records.push(
        10,
        m.x,
        20,
        sheet.height - m.y,
        30,
        0,
        40,
        m.size * 0.718,
        1,
        m.value
          .replaceAll("Ø", "%%c")
          .replaceAll("°", "%%d")
          .replace(
            /[^\x00-\x7F]/g,
            (c) =>
              "\\U+" +
              c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"),
          )
          .replace(/[\r\n]/g, " "),
        50,
        -(m.rotation || 0),
        72,
        align,
        11,
        m.x,
        21,
        sheet.height - m.y,
        31,
        0,
        100,
        "AcDbText",
        73,
        0,
      );
    } else if (m.type === "circle") {
      entity("CIRCLE", layer, "AcDbCircle");
      records.push(10, m.x, 20, sheet.height - m.y, 30, 0, 40, m.radius);
    } else if (m.upperSemicircle) {
      const { x, y, radius } = m.upperSemicircle;
      entity("LWPOLYLINE", layer, "AcDbPolyline");
      // DXF uses Y-up. From left to right, the upper semicircle is clockwise.
      records.push(
        90,
        2,
        70,
        1,
        10,
        x - radius,
        20,
        sheet.height - y,
        42,
        -1,
        10,
        x + radius,
        20,
        sheet.height - y,
      );
    } else if (m.fill && m.pts.length === 3 && m.weight !== 0) {
      entity("SOLID", layer, "AcDbTrace");
      for (const [i, p] of [...m.pts, m.pts[2]].entries())
        records.push(10 + i, p[0], 20 + i, sheet.height - p[1], 30 + i, 0);
    } else {
      entity("LWPOLYLINE", layer, "AcDbPolyline");
      records.push(90, m.pts.length, 70, m.close ? 1 : 0);
      if (layer === "Graduations") records.push(43, m.weight ?? 0.25);
      for (const [x, y] of m.pts) records.push(10, x, 20, sheet.height - y);
    }
  }
  return [...records, 0, "ENDSEC", 0, "EOF"].join("\r\n") + "\r\n";
}
export function printSheet(sheet: Sheet, title: string) {
  return printSheets([sheet], title);
}
export function printSheets(sheets: Sheet[], title: string) {
  if (!sheets.length) return false;
  const sheet = sheets[0];
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(
    `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:${sheet.width}mm ${sheet.height}mm;margin:0}*{margin:0;padding:0}body{background:white}svg{display:block}article{break-after:page;page-break-after:always}article:last-child{break-after:auto;page-break-after:auto}</style>${sheets.map((s) => "<article>" + svgFile(s) + "</article>").join("")}`,
  );
  win.document.close();
  win.focus();
  win.setTimeout(() => win.print(), 180);
  return true;
}
