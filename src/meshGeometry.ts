export type MeshPoint = [number, number, number];
export type PrintMesh = { vertices: MeshPoint[]; triangles: number[][] };

export const LINEAR_DEFLECTION_MM = 0.005;
export const ANGULAR_DEFLECTION_RAD = 0.08;

export function subtract(a: MeshPoint, b: MeshPoint): MeshPoint {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function cross(a: MeshPoint, b: MeshPoint): MeshPoint {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function dot(a: MeshPoint, b: MeshPoint) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function midpoint(a: MeshPoint, b: MeshPoint): MeshPoint {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
/** Drop the dominant normal axis; cyclic order and sign preserve outward winding in 2D. */
export function planeAxes(normal: MeshPoint) {
  const absolute = normal.map(Math.abs);
  const drop = absolute.indexOf(Math.max(...absolute));
  return {
    drop,
    x: (drop + 1) % 3,
    y: (drop + 2) % 3,
    sign: Math.sign(normal[drop]),
  };
}
