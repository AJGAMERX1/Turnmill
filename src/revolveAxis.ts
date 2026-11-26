export const axisCrossingMessage =
  "This profile crosses the dashed X axis (Y = 0). Sketch one half of the part, entirely above or below the line. An edge can lie on the line. Revolve creates the other half.";

export function crossesRevolveAxis(points: ReadonlyArray<readonly [number, number]>) {
  const tolerance = 1e-7;
  return points.some(([, y]) => y < -tolerance) && points.some(([, y]) => y > tolerance);
}
