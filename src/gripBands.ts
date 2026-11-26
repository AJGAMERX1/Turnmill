import { BoundingBox, getOC, type AnyShape, type Face, type Shape3D } from "replicad";

export type GripBand = { start: number; end: number; startRadius: number; endRadius: number };
export type GripStock = { minX: number; maxX: number; bands: GripBand[] };

const tolerance = 1e-6;
type Interval = [number, number];

export function gripRadiusAt(band: GripBand, x: number) {
  return band.startRadius + (band.endRadius - band.startRadius) * ((x - band.start) / (band.end - band.start));
}

function xBounds(shape: AnyShape): Interval {
  const box = new BoundingBox();
  try {
    getOC().BRepBndLib.AddOptimal(shape.wrapped, box.wrapped, false, false);
    return [box.wrapped.GetXMin(), box.wrapped.GetXMax()];
  } finally { box.delete(); }
}

/** Read the analytic surface in world coordinates, even when the face covers only part of a turn. */
function turnedFace(face: Face): GripBand | undefined {
  const surface = face.surface;
  try {
    const type = surface.surfaceType;
    if (type === "REVOLUTION_SURFACE") {
      // OCCT represents shallow straight tapers as general surfaces of revolution.
      const meridian = surface.wrapped.BasisCurve();
      try { if (meridian.GetType() !== getOC().GeomAbs_CurveType.GeomAbs_Line) return; }
      finally { meridian.delete(); }
    } else if (type !== "CYLINDRE" && type !== "CONE") return;
    const { uMin, vMin, vMax } = face.UVBounds;
    const ring = (v: number) => {
      const a = surface.wrapped.Value(uMin, v), b = surface.wrapped.Value(uMin + Math.PI, v);
      try {
        return { x: (a.X() + b.X()) / 2,
          y: (a.Y() + b.Y()) / 2, z: (a.Z() + b.Z()) / 2,
          radius: a.Distance(b) / 2 };
      } finally { a.delete(); b.delete(); }
    };
    let a = ring(vMin), b = ring(vMax);
    if (Math.hypot(a.y, a.z) > tolerance || Math.hypot(b.y, b.z) > tolerance) return;
    if (b.x < a.x) [a, b] = [b, a];
    if (b.x - a.x < tolerance) return;
    const point = face.pointOnSurface(.33, .5), normal = face.normalAt(point);
    try {
      const [, y, z] = point.toTuple(), [, ny, nz] = normal.toTuple();
      if (y * ny + z * nz <= 0) return; // A bore cannot carry an exterior grip.
    } finally { normal.delete(); point.delete(); }
    return { start: a.x, end: b.x, startRadius: a.radius, endRadius: b.radius };
  } finally { surface.delete(); }
}

function union(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [start, end] of intervals.sort((a,b) => a[0] - b[0])) {
    const previous = result.at(-1);
    if (previous && start <= previous[1] + tolerance) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}

/** An exterior pocket can contain another outward-facing wall. Exclude its
 * shadow on smaller, concentric lands so a radial cutter can reach the band. */
function shadow(inner: GripBand, outer: GripBand, [lo, hi]: Interval): Interval | undefined {
  const from = Math.max(inner.start, lo), to = Math.min(inner.end, hi);
  if (to - from <= tolerance) return;
  const a = gripRadiusAt(outer, from) - gripRadiusAt(inner, from);
  const b = gripRadiusAt(outer, to) - gripRadiusAt(inner, to);
  if (Math.max(a,b) <= tolerance) return;
  if (Math.min(a,b) >= -tolerance) return [from, to];
  const crossing = from + a / (a - b) * (to - from);
  return a > 0 ? [from, crossing] : [crossing, to];
}

/** At every station of a usable band the whole ring must be present. A free
 * trimming edge rules out its X interval, including slots and transverse holes.
 * Seams and shared edges between same-domain faces do not interrupt the ring. */
export function measureGripStock(shape: Shape3D): GripStock {
  const [minX, maxX] = xBounds(shape);
  const groups: { law: GripBand; spans: Interval[]; boundary: Map<number, Interval | null> }[] = [];
  const faces = shape.faces;
  try {
    for (const face of faces) {
      const band = turnedFace(face);
      if (!band) continue;
      let group = groups.find(({ law }) =>
        Math.abs(gripRadiusAt(law, band.start) - band.startRadius) <= tolerance &&
        Math.abs(gripRadiusAt(law, band.end) - band.endRadius) <= tolerance &&
        Math.abs(gripRadiusAt(band, law.start) - law.startRadius) <= tolerance &&
        Math.abs(gripRadiusAt(band, law.end) - law.endRadius) <= tolerance);
      if (!group) {
        group = { law: band, spans: [], boundary: new Map() };
        groups.push(group);
      }
      group.spans.push([band.start, band.end]);
      const edges = face.edges;
      try {
        for (const edge of edges) {
          if (getOC().BRep_Tool.IsClosed(edge.wrapped, face.wrapped)) continue;
          const key = edge.hashCode;
          if (group.boundary.has(key)) group.boundary.set(key, null);
          else group.boundary.set(key, xBounds(edge));
        }
      } finally { edges.forEach(edge => edge.delete()); }
    }
  } finally { faces.forEach(face => face.delete()); }

  const bands: GripBand[] = [];
  for (const { law, spans, boundary } of groups) {
    const trim = [...boundary.values()].filter((edge): edge is Interval =>
      edge !== null && edge[1] - edge[0] > tolerance);
    const add = (start: number, end: number) => {
      if (end - start > tolerance) bands.push({
        start, end, startRadius: gripRadiusAt(law, start), endRadius: gripRadiusAt(law, end),
      });
    };
    for (const [start, end] of union(spans)) {
      const range = { start, end, startRadius: gripRadiusAt(law, start), endRadius: gripRadiusAt(law, end) };
      const obstacles = [...trim];
      for (const outer of groups) {
        if (outer.law === law) continue;
        for (const span of outer.spans) {
          const covered = shadow(range, outer.law, span);
          if (covered) obstacles.push(covered);
        }
      }
      const blocked = union(obstacles);
      let cursor = start;
      for (const [from, to] of blocked) {
        if (to <= cursor) continue;
        if (from >= end) break;
        add(cursor, Math.min(end, from));
        cursor = Math.max(cursor, to);
      }
      add(cursor, end);
    }
  }
  return { minX, maxX, bands: bands.sort((a,b) => a.start - b.start || b.startRadius - a.startRadius) };
}
