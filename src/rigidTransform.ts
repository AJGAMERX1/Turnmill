/** Three.js column-major rigid transform in millimetres (rotation plus translation). */
export function isRigidTransform(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== 16 || !Array.from(value).every(Number.isFinite)) return false;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-8;
  if (![3, 7, 11].every(i => near(value[i], 0)) || !near(value[15], 1)) return false;
  const dot = (a: number, b: number) =>
    value[a] * value[b] + value[a + 1] * value[b + 1] + value[a + 2] * value[b + 2];
  for (const i of [0, 4, 8]) {
    if (!near(dot(i, i), 1)) return false;
  }
  if (![dot(0, 4), dot(0, 8), dot(4, 8)].every(n => near(n, 0))) return false;
  const determinant =
    value[0] * (value[5] * value[10] - value[6] * value[9]) -
    value[4] * (value[1] * value[10] - value[2] * value[9]) +
    value[8] * (value[1] * value[6] - value[2] * value[5]);
  return near(determinant, 1);
}
