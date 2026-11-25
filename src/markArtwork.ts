import {
  Box2,
  CubicBezierCurve,
  EllipseCurve,
  LineCurve,
  QuadraticBezierCurve,
  Vector2,
  type Path,
  type Shape,
} from "three";
import {
  FontLoader,
  type FontData,
} from "three/examples/jsm/loaders/FontLoader.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import helvetiker from "three/examples/fonts/helvetiker_regular.typeface.json" with { type: "json" };

import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json" with { type: "json" };

export type InkPoint = [number, number];
/** A planar outline is a sequence of lines, quadratic Beziers and cubic Beziers. */
export type InkOutline = InkPoint[][];
export type Artwork = {
  width: number;
  outlines: { outer: InkOutline; holes: InkOutline[] }[];
};
const regular = new FontLoader().parse(helvetiker as unknown as FontData);
const bold = new FontLoader().parse(helvetikerBold as unknown as FontData);

function normalize(shapes: Shape[], flipY = false): Artwork {
  const bounds = new Box2();
  for (const s of shapes)
    for (const p of s.getPoints(24)) bounds.expandByPoint(p);
  const size = bounds.getSize(new Vector2());
  if (!(size.x > 0 && size.y > 0))
    throw Error("The artwork has no filled area.");
  const midY = bounds.getCenter(new Vector2()).y;
  const pt = (p: Vector2): InkPoint => [
    (p.x - bounds.min.x) / size.y,
    ((flipY ? -1 : 1) * (p.y - midY)) / size.y,
  ];
  function outline(path: Path): InkOutline {
    const segments: InkOutline = [];
    for (const c of path.curves) {
      if (c instanceof LineCurve) segments.push([pt(c.v1), pt(c.v2)]);
      else if (c instanceof QuadraticBezierCurve)
        segments.push([pt(c.v0), pt(c.v1), pt(c.v2)]);
      else if (c instanceof CubicBezierCurve)
        segments.push([pt(c.v0), pt(c.v1), pt(c.v2), pt(c.v3)]);
      else {
        const points = c.getPoints(c instanceof EllipseCurve ? 48 : 32).map(pt);
        for (let i = 1; i < points.length; i++)
          segments.push([points[i - 1], points[i]]);
      }
    }
    const tol = 1e-9,
      dist = (a: InkPoint, b: InkPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const keep = segments.filter(
      (s) => s.length > 2 || dist(s[0], s.at(-1)!) > tol,
    );
    if (keep.length < 2) throw Error("An artwork contour has no closed area.");
    const a = keep[0][0],
      b = keep.at(-1)!.at(-1)!;
    if (dist(a, b) > tol) keep.push([b, a]);
    return keep;
  }
  return {
    width: size.x / size.y,
    outlines: shapes.map((shape) => ({
      outer: outline(shape),
      holes: shape.holes.map(outline),
    })),
  };
}
export function textArtwork(text: string, useBold = false) {
  const font = useBold ? bold : regular;
  if (!text.trim()) throw Error("Enter text for the mark.");
  if ([...text].some((char) => !font.data.glyphs[char] && char !== " "))
    throw Error(
      "The bundled engraving font does not contain every character in this mark.",
    );
  return normalize(font.generateShapes(text, 1));
}
export function svgArtwork(text: string) {
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  if (
    parsed.querySelector("parsererror") ||
    parsed.documentElement.localName !== "svg"
  )
    throw Error("Choose an SVG document with filled paths.");
  const data = new SVGLoader().parse(text);
  const shapes = data.paths
    .filter((path) => path.userData?.style?.fill !== "none")
    .flatMap((path) => SVGLoader.createShapes(path));
  if (!shapes.length)
    throw Error("Convert the graphic to filled outlines before importing it.");
  return normalize(shapes, true);
}
