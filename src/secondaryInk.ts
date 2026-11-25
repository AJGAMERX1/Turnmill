import {
  textArtwork,
  type Artwork,
  type InkOutline,
  type InkPoint,
} from "./markArtwork";
export const cadFont = "Helvetiker CAD";
export const boldCadFont = "Helvetiker Bold CAD";
export const isCadFont = (font: string) =>
  font === cadFont || font === boldCadFont;
const cache = new Map<string, Artwork>();
export function numeralInk(
  text: string,
  x: number,
  y: number,
  size: number,
  anchor: string,
  rotation: number,
  face = cadFont,
): Artwork["outlines"] {
  const key = face + "|" + text;
  let art = cache.get(key);
  if (!art) {
    art = textArtwork(text, face === boldCadFont);
    if (cache.size >= 700) cache.clear();
    cache.set(key, art);
  }
  const height = 0.718 * size,
    width = art.width * height,
    shift = anchor === "end" ? -width : anchor === "middle" ? -width / 2 : 0;
  const theta = (rotation * Math.PI) / 180,
    c = Math.cos(theta),
    s = Math.sin(theta);
  const map = (p: InkPoint): InkPoint => {
    const u = shift + p[0] * height,
      v = -(0.5 + p[1]) * height;
    return [x + u * c - v * s, y + u * s + v * c];
  };
  const loop = (l: InkOutline) => l.map((seg) => seg.map(map));
  return art.outlines.map((g) => ({
    outer: loop(g.outer),
    holes: g.holes.map(loop),
  }));
}
export function inkPath(components: Artwork["outlines"]) {
  const pt = ([x, y]: InkPoint) =>
    Number(x.toFixed(6)) + " " + Number(y.toFixed(6));
  function loop(s: InkOutline) {
    return (
      "M" +
      pt(s[0][0]) +
      s
        .map(
          (seg) =>
            (seg.length === 2 ? "L" : seg.length === 3 ? "Q" : "C") +
            seg.slice(1).map(pt).join(" "),
        )
        .join("") +
      "Z"
    );
  }
  return components
    .map((g) => [g.outer, ...g.holes].map(loop).join(""))
    .join("");
}
export function flattenInk(outline: InkOutline, tolerance = 0.003): InkPoint[] {
  const pts: InkPoint[] = [outline[0][0]];
  function append(c: InkPoint[], depth: number) {
    const a = c[0],
      b = c.at(-1)!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy);
    const error = Math.max(
      0,
      ...c
        .slice(1, -1)
        .map(([x, y]) =>
          len > 1e-12
            ? Math.abs(dy * (x - a[0]) - dx * (y - a[1])) / len
            : Math.hypot(x - a[0], y - a[1]),
        ),
    );
    if (error <= tolerance || depth >= 16) {
      pts.push(b);
      return;
    }
    const left = [a],
      right = [b];
    let work = c;
    while (work.length > 1) {
      work = work
        .slice(1)
        .map(
          (p, i) =>
            [(p[0] + work[i][0]) / 2, (p[1] + work[i][1]) / 2] as InkPoint,
        );
      left.push(work[0]);
      right.unshift(work.at(-1)!);
    }
    append(left, depth + 1);
    append(right, depth + 1);
  }
  for (const seg of outline) append(seg, 0);
  if (Math.hypot(pts[0][0] - pts.at(-1)![0], pts[0][1] - pts.at(-1)![1]) < 1e-8)
    pts.pop();
  return pts;
}
