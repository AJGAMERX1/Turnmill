import { closedSweepMesh } from "./closedSweepMesh";
import { prismaticMesh } from "./prismaticMesh";
import { type Shape3D } from "replicad";

import {
  subtract,
  cross,
  planeAxes,
  LINEAR_DEFLECTION_MM,
  ANGULAR_DEFLECTION_RAD,
  type MeshPoint as Point,
  type PrintMesh,
} from "./meshGeometry";

function unit(a: Point): Point {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
}
function normal(vertices: Point[], [a, b, c]: number[]) {
  return cross(
    subtract(vertices[b], vertices[a]),
    subtract(vertices[c], vertices[a]),
  );
}

function fanVisibleBoundary(vertices: Point[], facets: number[][]) {
  if (facets.length < 8) return facets;
  // Extract only the original face boundary. All neighboring curved-face samples stay fixed.
  const boundary = new Map<string, [number, number]>();
  let largest = 0,
    n: Point = [0, 0, 0];
  for (const triangle of facets) {
    const c = normal(vertices, triangle);
    const size = Math.hypot(...c);
    if (size > largest) {
      largest = size;
      n = unit(c);
    }
    for (let i = 0; i < 3; i++) {
      const a = triangle[i],
        b = triangle[(i + 1) % 3],
        key = Math.min(a, b) + "," + Math.max(a, b);
      if (!boundary.delete(key)) boundary.set(key, [a, b]);
    }
  }
  const indices = [...new Set([...boundary.values()].flat())];
  if (indices.length < 3 || largest === 0) return facets;
  const map = new Map(indices.map((id, i) => [id, i]));
  const edges = [...boundary.values()].map(([a, b]) => [
    map.get(a)!,
    map.get(b)!,
  ]);
  const { x, y, sign } = planeAxes(n);
  const pts = indices.map((id) => [vertices[id][x], vertices[id][y] * sign]);
  const center: Point = [0, 0, 0];
  for (const id of indices)
    for (const k of [0, 1, 2]) center[k] += vertices[id][k] / indices.length;
  for (const k of [0, 1, 2]) center[k] = Math.fround(center[k]);
  // A centroid in the kernel sees every oriented side. A fan avoids tangential
  // slivers on circular end caps, without changing any boundary samples.
  const cx = center[x],
    cy = center[y] * sign;
  if (
    edges.every(
      ([a, b]) =>
        (pts[b][0] - pts[a][0]) * (cy - pts[a][1]) -
          (pts[b][1] - pts[a][1]) * (cx - pts[a][0]) >
        1e-12,
    )
  ) {
    const tip = vertices.length;
    vertices.push(center);
    return edges.map(([a, b]) => [indices[a], indices[b], tip]);
  }
  return facets;
}

/** Keep a single indexed, ordered triangle representation for both manufacturing formats. */
export function printableMesh(shape: Shape3D): PrintMesh {
  const faces = shape.faces,
    planes = new Set<number>();
  let mesh;
  try {
    const swept = closedSweepMesh(faces);
    if (swept) {
      const checked = checkedMesh(swept);
      if (checked) return checked;
    }
    mesh = shape.mesh({
      tolerance: LINEAR_DEFLECTION_MM,
      angularTolerance: ANGULAR_DEFLECTION_RAD,
    });
    const prism = prismaticMesh(faces, mesh);
    if (prism) {
      const checked = checkedMesh(prism);
      if (checked) return checked;
    }
    for (const f of faces) {
      if (f.geomType === "PLANE") planes.add(f.hashCode);
    }
  } finally {
    for (const f of faces) f.delete();
  }
  const vertices: Point[] = [],
    index: number[] = [],
    ids = new Map<string, number>();
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const p: Point = [
      mesh.vertices[i],
      mesh.vertices[i + 1],
      mesh.vertices[i + 2],
    ];
    if (!p.every(Number.isFinite))
      throw Error("A mesh vertex has invalid coordinates.");
    const key = p.map((v) => Math.round(v * 1e7)).join(",");
    let id = ids.get(key);
    if (id === undefined) {
      id = vertices.length;
      ids.set(key, id);
      vertices.push(p);
    }
    index.push(id);
  }
  const triangles: number[][] = [],
    kernelFacets: number[][] = [];
  for (const group of mesh.faceGroups) {
    const facets: number[][] = [];
    for (let k = group.start; k < group.start + group.count; k += 3) {
      const a = index[mesh.triangles[k]],
        b = index[mesh.triangles[k + 1]],
        c = index[mesh.triangles[k + 2]];
      // At a cone apex OpenCascade can return both ends of the periodic seam at the same point.
      if (a !== b && b !== c && c !== a) facets.push([a, b, c]);
    }
    for (const facet of facets) kernelFacets.push(facet);
    const result = planes.has(group.faceId)
      ? fanVisibleBoundary(vertices, facets)
      : facets;
    for (const facet of result) triangles.push(facet);
  }
  const bounded =
    checkedMesh({ vertices, triangles }) ??
    checkedMesh({ vertices, triangles: kernelFacets });
  if (bounded) return bounded;
  throw Error(
    "The bounded tessellation has a collapsed, open or inconsistently oriented face. Export STEP to retain the exact solid.",
  );
}

// The optional surface samplers fall back to OpenCascade if they cannot form a closed
// oriented mesh. A zero-area or open final kernel mesh is never written to disk.
function checkedMesh({ vertices, triangles }: PrintMesh): PrintMesh | null {
  if (!triangles.length) return null;
  const incidence = new Map<number, number>(),
    orientation = new Map<number, number>();
  const indices = new Map<number, number>(),
    compact: Point[] = [];
  for (const triangle of triangles) {
    const area = normal(vertices, triangle);
    if (!area.every(Number.isFinite) || Math.hypot(...area) === 0) return null;
    for (let k = 0; k < 3; k++) {
      const a = triangle[k],
        b = triangle[(k + 1) % 3],
        key = Math.min(a, b) * vertices.length + Math.max(a, b);
      incidence.set(key, (incidence.get(key) ?? 0) + 1);
      orientation.set(key, (orientation.get(key) ?? 0) + (a < b ? 1 : -1));
      if (!indices.has(a)) {
        indices.set(a, compact.length);
        compact.push(vertices[a]);
      }
    }
  }
  for (const [key, count] of incidence)
    if (count !== 2 || orientation.get(key) !== 0) return null;
  return {
    vertices: compact,
    triangles: triangles.map((t) => t.map((i) => indices.get(i)!)),
  };
}

export function binarySTL(meshes: PrintMesh[]): Blob {
  const count = meshes.reduce((n, m) => n + m.triangles.length, 0);
  const data = new ArrayBuffer(84 + 50 * count),
    view = new DataView(data);
  view.setUint32(80, count, true);
  let at = 84;
  for (const { vertices, triangles } of meshes)
    for (const triangle of triangles) {
      const n = unit(normal(vertices, triangle));
      for (const p of [n, ...triangle.map((i) => vertices[i])])
        for (const v of p) {
          view.setFloat32(at, v, true);
          at += 4;
        }
      at += 2;
    }
  return new Blob([data], { type: "model/stl" });
}
