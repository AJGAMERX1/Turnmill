export const axisCrossingMessage =
  "This profile crosses the dashed X axis (Y = 0). Keep the closed profile above or below the axis. An edge may lie on the axis.";

export function crossesRevolveAxis(points: ReadonlyArray<readonly [number, number]>) {
  const tolerance = 1e-7;
  return points.some(([, y]) => y < -tolerance) && points.some(([, y]) => y > tolerance);
}
