import type { XY } from "./secondaryVector";

// A polygonal meridian is piecewise linear. Its greatest radius in a closed
// axial interval occurs at a vertex or an intersection with an interval end.
export function maxRadiusInBand(
  profile: XY[],
  left: number,
  right: number,
): number | null {
  const samples: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i],
      b = profile[(i + 1) % profile.length];
    if (a[0] >= left && a[0] <= right) samples.push(Math.abs(a[1]));
    if (b[0] === a[0]) continue;
    for (const x of [left, right]) {
      const f = (x - a[0]) / (b[0] - a[0]);
      if (f >= 0 && f <= 1) samples.push(Math.abs(a[1] + f * (b[1] - a[1])));
    }
  }
  return samples.length ? Math.max(...samples) : null;
}
// Schaeffler, Plain Bearings HG 1, tables of housing and shaft deviations.
// https://www.schaeffler.it/remotemedien/media/_shared_media/08_media_library/01_publications/schaeffler_2/catalogue_1/downloads_6/hg_1_de_en.pdf
// Each upper size boundary is inclusive. Deviations are in integer micrometres.
const sizeBands = [
  // up to, IT7, IT6, g upper, k lower, p lower
  [3, 10, 6, -2, 0, 6],
  [6, 12, 8, -4, 1, 12],
  [10, 15, 9, -5, 1, 15],
  [18, 18, 11, -6, 1, 18],
  [30, 21, 13, -7, 2, 22],
  [50, 25, 16, -9, 2, 26],
] as const;
export const fitClasses = ["H7/g6", "H7/h6", "H7/k6", "H7/p6"] as const;
export type FitClass = (typeof fitClasses)[number];
export function fitLimits(d: number, code: FitClass = "H7/g6") {
  const band = sizeBands.find((r) => d <= r[0]);
  if (!Number.isFinite(d) || d < 1 || !band || !fitClasses.includes(code))
    return null;
  const [, it7, it6, g, k, p] = band;
  const lower = { "H7/g6": g - it6, "H7/h6": -it6, "H7/k6": k, "H7/p6": p }[
    code
  ];
  const upper = lower + it6;
  const min = -upper || 0,
    max = it7 - lower;
  return {
    holeMin: d,
    holeMax: d + it7 / 1000,
    shaftMin: d + lower / 1000,
    shaftMax: d + upper / 1000,
    min: min / 1000,
    max: max / 1000,
    kind:
      min >= 0
        ? "Clearance fit"
        : max <= 0
          ? "Interference fit"
          : "Transition fit",
  };
}
