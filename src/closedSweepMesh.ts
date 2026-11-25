import { getOC, type Face } from "replicad";
import {
  dot,
  cross,
  subtract,
  midpoint,
  LINEAR_DEFLECTION_MM,
  ANGULAR_DEFLECTION_RAD,
  type MeshPoint as Point,
  type PrintMesh,
} from "./meshGeometry";

const dist = (a: Point, b: Point) => Math.hypot(...subtract(a, b));
function angle(a: Point, b: Point, c: Point) {
  const v: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    w: Point = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  return Math.acos(
    Math.max(
      -1,
      Math.min(1, dot(v, w) / (Math.hypot(...v) * Math.hypot(...w))),
    ),
  );
}

/** Tessellate an untrimmed, periodic sweep between two planar caps from its exact surface. */
export function closedSweepMesh(faces: Face[]): PrintMesh | null {
  if (faces.length !== 3) return null;
  const side = faces.find((f) => f.geomType === "BSPLINE_SURFACE");
  const caps = faces.filter((f) => f.geomType === "PLANE");
  if (!side || caps.length !== 2) return null;
  for (const f of [side, ...caps]) {
    const wires = f.wires,
      edges = f.edges;
    try {
      if (wires.length !== 1 || edges.length !== (f === side ? 3 : 1))
        return null;
    } finally {
      wires.forEach((w) => w.delete());
      edges.forEach((e) => e.delete());
    }
  }
  const oc = getOC(),
    ad = new oc.BRepAdaptor_Surface(side.wrapped, true);
  const box = side.UVBounds;
  try {
    if (!ad.IsUClosed()) return null;
    const at = (u: number, v: number): Point => {
      const p = ad.Value(
        box.uMin + (box.uMax - box.uMin) * u,
        box.vMin + (box.vMax - box.vMin) * v,
      );
      try {
        return [p.X(), p.Y(), p.Z()];
      } finally {
        p.delete();
      }
    };
    // Start inside each polynomial knot span so repeated turns cannot alias to one chord.
    const bs = ad.BSpline();
    function knots(
      count: number,
      get: (i: number) => number,
      min: number,
      max: number,
    ) {
      const breaks = [0, 1];
      for (let i = 1; i <= count; i++) {
        const t = (get(i) - min) / (max - min);
        if (t > 1e-9 && t < 1 - 1e-9) breaks.push(t);
      }
      return [...new Set(breaks)]
        .sort((a, b) => a - b)
        .filter((t, i, all) => i === 0 || t - all[i - 1] > 1e-9);
    }
    let us: number[], vs: number[];
    try {
      us = knots(bs.NbUKnots(), (k) => bs.UKnot(k), box.uMin, box.uMax);
      vs = knots(bs.NbVKnots(), (k) => bs.VKnot(k), box.vMin, box.vMax);
    } finally {
      bs.delete();
    }
    const capPlanes = caps.map((f) => {
      const p = f.center,
        n = f.normalAt();
      try {
        return [p.toTuple(), n.toTuple()];
      } finally {
        p.delete();
        n.delete();
      }
    });
    const isOn = (p: Point, plane: number[][]) =>
      Math.abs(
        (p[0] - plane[0][0]) * plane[1][0] +
          (p[1] - plane[0][1]) * plane[1][1] +
          (p[2] - plane[0][2]) * plane[1][2],
      ) < 1e-6;
    const endPlanes = [0, 1].map((v) =>
      capPlanes.find((plane) =>
        [0, 0.25, 0.5, 0.75].every((u) => isOn(at(u, v), plane)),
      ),
    );
    if (!endPlanes[0] || !endPlanes[1] || endPlanes[0] === endPlanes[1])
      return null;
    // Leave room under the 5 µm chord budget for the diagonal of each quad.
    // The angle between half-chords is half the included turn on a circle.
    const outside = (a: Point, m: Point, b: Point) =>
      dist(midpoint(a, b), m) > LINEAR_DEFLECTION_MM * 0.6 ||
      angle(a, m, b) > ANGULAR_DEFLECTION_RAD * 0.4375;
    // Refine whole isoparametric strips together to avoid T-junctions across the seam.
    // The native bounded mesh remains available for high-degree or very large patches.
    for (let pass = 0; pass < 14; pass++) {
      const splitU = new Set<number>(),
        splitV = new Set<number>();
      for (let j = 0; j < vs.length - 1; j++)
        for (let i = 0; i < us.length - 1; i++) {
          const u = us[i],
            w = us[i + 1],
            v = vs[j],
            q = vs[j + 1],
            um = (u + w) / 2,
            vm = (v + q) / 2;
          const a = at(u, v),
            b = at(w, v),
            c = at(w, q),
            d = at(u, q);
          const e = at(um, v),
            f = at(w, vm),
            g = at(um, q),
            h = at(u, vm),
            middle = at(um, vm);
          if (outside(a, e, b) || outside(d, g, c)) splitU.add(um);
          if (outside(a, h, d) || outside(b, f, c)) splitV.add(vm);
          if (
            dist(midpoint(a, c), middle) > LINEAR_DEFLECTION_MM * 0.8 &&
            !splitU.has(um) &&
            !splitV.has(vm)
          ) {
            splitU.add(um);
            splitV.add(vm);
          }
        }
      if (!splitU.size && !splitV.size) break;
      if (
        pass === 13 ||
        (us.length + splitU.size) * (vs.length + splitV.size) > 1000000
      )
        return null;
      us = [...us, ...splitU].sort((a, b) => a - b);
      vs = [...vs, ...splitV].sort((a, b) => a - b);
    }
    const vertices: Point[] = [],
      triangles: number[][] = [],
      width = us.length - 1;
    for (const v of vs)
      for (let i = 0; i < width; i++)
        vertices.push(at(us[i], v).map(Math.fround) as Point);
    for (const [j, plane] of [
      [0, endPlanes[0]],
      [vs.length - 1, endPlanes[1]],
    ] as const) {
      for (let i = 0; i < width; i++)
        if (!isOn(at(us[i], vs[j]), plane)) return null;
    }
    const row = (j: number, i: number) => j * width + (i % width);
    for (let j = 0; j < vs.length - 1; j++)
      for (let i = 0; i < width; i++) {
        const a = row(j, i),
          b = row(j, i + 1),
          c = row(j + 1, i + 1),
          d = row(j + 1, i);
        triangles.push([a, b, c], [a, c, d]);
      }
    for (const j of [0, vs.length - 1]) {
      const center: Point = [0, 0, 0];
      for (let i = 0; i < width; i++) {
        const p = vertices[row(j, i)];
        for (const k of [0, 1, 2]) center[k] += p[k] / width;
      }
      const id = vertices.length;
      vertices.push(center.map(Math.fround) as Point);
      let reference: Point | undefined;
      for (let i = 0; i < width; i++) {
        const a = row(j, i),
          b = row(j, i + 1),
          p = vertices[a],
          q = vertices[b];
        const n = cross(subtract(p, center), subtract(q, center));
        if (reference && dot(n, reference) <= 0) return null;
        reference ??= n;
        triangles.push(j === 0 ? [b, a, id] : [a, b, id]);
      }
    }
    if (side.orientation === "backward") for (const f of triangles) f.reverse();
    return { vertices, triangles };
  } finally {
    ad.delete();
  }
}
