import triangulate from "cdt2d";
import { getOC, type Edge, type Face, type ShapeMesh } from "replicad";
import {
  subtract as diff,
  cross,
  dot,
  planeAxes,
  LINEAR_DEFLECTION_MM,
  ANGULAR_DEFLECTION_RAD,
  type MeshPoint as Point,
  type PrintMesh,
} from "./meshGeometry";

/** Linear extrusions share a master curve between their two end edges. Keep that
 * curve's sampling at both levels so caps and walls meet along identical chords. */
export function prismaticMesh(
  faces: Face[],
  mesh: ShapeMesh,
): PrintMesh | null {
  const extrusion = faces.find((f) => f.geomType === "EXTRUSION_SURFACE");
  if (
    !extrusion ||
    faces.some((f) => !["PLANE", "EXTRUSION_SURFACE"].includes(f.geomType))
  )
    return null;
  const oc = getOC(),
    ad = new oc.BRepAdaptor_Surface(extrusion.wrapped, false);
  const axis = ad.Direction(),
    n: Point = [axis.X(), axis.Y(), axis.Z()];
  axis.delete();
  ad.delete();
  const vertices: Point[] = [],
    triangles: number[][] = [],
    vertexIds = new Map<string, number>(),
    curves = new Map<number, number[]>();
  function vertex(v: Point) {
    const p = v.map(Math.fround) as Point,
      key = p.map((x) => Math.round(x * 1e7)).join(",");
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = vertices.length;
      vertices.push(p);
      vertexIds.set(key, id);
    }
    return id;
  }
  function curve(e: Edge) {
    const old = curves.get(e.hashCode);
    if (old) return old;
    const geom = new oc.BRepAdaptor_Curve(e.wrapped);
    try {
      const sample = new oc.GCPnts_TangentialDeflection(
        geom,
        geom.FirstParameter(),
        geom.LastParameter(),
        ANGULAR_DEFLECTION_RAD,
        LINEAR_DEFLECTION_MM * 0.6,
        2,
        1e-9,
        1e-7,
      );
      try {
        const result: number[] = [];
        for (let k = 1; k <= sample.NbPoints(); k++) {
          const p = sample.Value(k);
          const i = vertex([p.X(), p.Y(), p.Z()]);
          p.delete();
          if (result.at(-1) !== i) result.push(i);
        }
        curves.set(e.hashCode, result);
        return result;
      } finally {
        sample.delete();
      }
    } finally {
      geom.delete();
    }
  }
  const groups = new Map(mesh.faceGroups.map((g) => [g.faceId, g]));
  for (const face of faces) {
    const g = groups.get(face.hashCode);
    if (!g || g.count < 3) return null;
    const ids = mesh.triangles.slice(g.start, g.start + 3);
    const [a, b, c] = ids.map(
      (i) => mesh.vertices.slice(3 * i, 3 * i + 3) as Point,
    );
    const outwardNormal = cross(diff(b, a), diff(c, a));
    if (Math.hypot(...outwardNormal) === 0) return null;
    const edgeList = face.edges;
    try {
      const shapes = edgeList.map(curve);
      if (shapes.some((edge) => edge.length < 2)) return null;
      const result =
        face.geomType === "PLANE"
          ? triangulateCap(face, shapes, vertices, vertex, outwardNormal, n)
          : triangulateWall(face, shapes, vertices, outwardNormal, n);
      if (!result) return null;
      for (const triangle of result) triangles.push(triangle);
    } finally {
      edgeList.forEach((e) => e.delete());
    }
  }
  return { vertices, triangles };
}

/** Preserve each boundary loop, including holes, in the projected cap triangulation. */
function triangulateCap(
  face: Face,
  shapes: number[][],
  vertices: Point[],
  vertex: (p: Point) => number,
  outwardNormal: Point,
  n: Point,
): number[][] | null {
  const flat = face.normalAt();
  const norm = flat.toTuple();
  flat.delete();
  if (dot(norm, outwardNormal) < 0)
    for (const i of [0, 1, 2]) norm[i] = -norm[i];
  const along = Math.abs(dot(norm, n));
  if (along > 1e-6 && along < 1 - 1e-6) return null;
  const samples = [...new Set(shapes.flat())],
    local = new Map(samples.map((id, i) => [id, i]));
  const { drop, x, y, sign } = planeAxes(norm);
  const points = samples.map((id) => [vertices[id][x], vertices[id][y] * sign]);
  const borders: number[][] = [];
  for (const shape of shapes)
    for (let j = 1; j < shape.length; j++)
      borders.push([local.get(shape[j - 1])!, local.get(shape[j])!]);
  // CDT requires closed, non-degenerate constraints. The original bounded
  // kernel mesh handles faces whose projected wires touch or collapse.
  const degree = new Uint32Array(points.length);
  for (const [a, b] of borders) {
    degree[a]++;
    degree[b]++;
  }
  if (
    degree.some((count) => count !== 2) ||
    new Set(points.map((p) => p.join(","))).size !== points.length
  )
    return null;
  let result = triangulate(points, borders, { exterior: false });
  // Give narrow boundary triangles an interior vertex so their longest edge
  // cannot bridge several nearly tangent engraving-wall chords.
  const segmentKey = (a: number, b: number) =>
    Math.min(a, b) + "," + Math.max(a, b);
  const boundary = new Set(borders.map(([a, b]) => segmentKey(a, b)));
  const samplesAt = new Set(points.map((p) => p.join(",")));
  let changed = false;
  for (const [a, b, c] of result) {
    const [A, B, C] = [points[a], points[b], points[c]],
      area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    const longest = Math.max(
      Math.hypot(B[0] - A[0], B[1] - A[1]),
      Math.hypot(C[0] - B[0], C[1] - B[1]),
      Math.hypot(C[0] - A[0], C[1] - A[1]),
    );
    if (area >= 0.08 * longest * longest) continue;
    for (const [m, l] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (!boundary.has(segmentKey(m, l))) continue;
      const q = points[m],
        r = points[l],
        dx = r[0] - q[0],
        dy = r[1] - q[1];
      const pos: Point = [...vertices[samples[m]]];
      pos[x] = Math.fround((q[0] + r[0]) / 2 - dy * 0.75);
      pos[y] = Math.fround(((q[1] + r[1]) / 2 + dx * 0.75) * sign);
      const origin = vertices[samples[m]];
      pos[drop] = Math.fround(
        origin[drop] -
          (norm[x] * (pos[x] - origin[x]) + norm[y] * (pos[y] - origin[y])) /
            norm[drop],
      );
      const uv = [pos[x], pos[y] * sign],
        key = uv.join(",");
      if (samplesAt.has(key)) continue;
      samplesAt.add(key);
      points.push(uv);
      samples.push(vertex(pos));
      changed = true;
    }
  }
  if (changed) result = triangulate(points, borders, { exterior: false });
  if (!result.length) return null;
  return result.map((tri) => tri.map((j) => samples[j]));
}

/** Zip the two matching profile curves in normalized arc-length order. */
function triangulateWall(
  face: Face,
  shapes: number[][],
  vertices: Point[],
  outwardNormal: Point,
  n: Point,
): number[][] | null {
  // The strip must consist of two profile edges on planes normal to the same
  // extrusion direction. Return other trimmed surfaces to the kernel mesher.
  const wallAdaptor = new (getOC().BRepAdaptor_Surface)(face.wrapped, false);
  try {
    const axis = wallAdaptor.Direction();
    try {
      if (Math.abs(dot(n, [axis.X(), axis.Y(), axis.Z()])) < 1 - 1e-9)
        return null;
    } finally {
      axis.delete();
    }
  } finally {
    wallAdaptor.delete();
  }
  const rows = shapes.filter((edge) =>
    edge.every(
      (id) => Math.abs(dot(diff(vertices[id], vertices[edge[0]]), n)) < 1e-5,
    ),
  );
  // Connecting trims must follow the ruling; diagonal or trimmed boundaries
  // need OpenCascade's unrestricted surface triangulation.
  for (const edge of shapes) {
    if (rows.includes(edge)) continue;
    const start = vertices[edge[0]];
    for (const id of edge) {
      const delta = diff(vertices[id], start),
        height = dot(delta, n);
      if (
        Math.hypot(...delta.map((value, axis) => value - height * n[axis])) >
        1e-5
      )
        return null;
    }
  }
  if (rows.length !== 2) return null;
  let [lower, upper] = rows;
  const d = (a: number, b: number) => {
    const delta = diff(vertices[a], vertices[b]),
      z = dot(delta, n);
    return Math.hypot(...delta.map((x, i) => x - z * n[i]));
  };
  if (d(lower[0], upper[0]) > d(lower[0], upper.at(-1)!))
    upper = [...upper].reverse();
  if (d(lower[0], upper[0]) > 1e-5 || d(lower.at(-1)!, upper.at(-1)!) > 1e-5)
    return null;
  const parameters = (row: number[]) => {
    const dist = [0];
    for (let i = 1; i < row.length; i++)
      dist.push(
        dist[i - 1] +
          Math.hypot(...diff(vertices[row[i]], vertices[row[i - 1]])),
      );
    return dist.map((s) => s / dist.at(-1)!);
  };
  const triangles: number[][] = [];
  const t = parameters(lower),
    u = parameters(upper);
  const back =
    dot(
      cross(
        diff(vertices[lower[1]], vertices[lower[0]]),
        diff(vertices[upper[0]], vertices[lower[0]]),
      ),
      outwardNormal,
    ) < 0;
  // Join both edge samplings in increasing arc-length order, keeping all
  // boundary vertices even when the upper and lower edge counts differ.
  let lowerIndex = 0,
    upperIndex = 0;
  while (lowerIndex + 1 < lower.length || upperIndex + 1 < upper.length) {
    const advanceLower =
      upperIndex + 1 === upper.length ||
      (lowerIndex + 1 < lower.length && t[lowerIndex + 1] <= u[upperIndex + 1]);
    const tri = advanceLower
      ? [lower[lowerIndex], lower[lowerIndex + 1], upper[upperIndex]]
      : [lower[lowerIndex], upper[upperIndex + 1], upper[upperIndex]];
    if (advanceLower) lowerIndex++;
    else upperIndex++;
    triangles.push(back ? tri.reverse() : tri);
  }
  return triangles;
}
