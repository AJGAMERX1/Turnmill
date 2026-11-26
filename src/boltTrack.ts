import { evaluate } from "./expressions";

/** Centerline travel in the developed surface of a pen's J-slot. */
export type BoltTrack = { throw: string; latch: string; radius: string; side: string };
export const defaultBoltTrack: BoltTrack = {
  throw: "4.6 mm", latch: "1.5 mm", radius: "5.2 mm", side: "3 mm",
};
export function resolveBoltTrack(track: BoltTrack = defaultBoltTrack, values: Record<string, number>) {
  const stroke = evaluate(track.throw, values);
  const latch = evaluate(track.latch, values);
  const radius = evaluate(track.radius, values);
  const side = evaluate(track.side, values);
  if (!(stroke > latch && latch > 0 && radius > 0 && Math.abs(side) > 0 && Math.abs(side) < radius))
    throw Error("Give the bolt a positive throw, a shorter latch return, a positive track radius and a sideways latch offset smaller than that radius.");
  const turn = Math.asin(side / radius);
  const arc = radius * Math.abs(turn);
  return { stroke, latch, radius, turn, arc, total: stroke + arc + latch };
}
export function boltTrackPosition(track: ReturnType<typeof resolveBoltTrack>, distance: number) {
  if (!Number.isFinite(distance)) throw Error("Enter a finite bolt travel.");
  const position = Math.min(track.total, Math.max(0, distance));
  const lockTravel = Math.min(track.arc, Math.max(0, position - track.stroke));
  const settle = Math.max(0, position - track.stroke - track.arc);
  return {
    axial: -Math.min(position, track.stroke) + settle,
    angle: -track.turn * lockTravel / track.arc,
    state: position <= 1e-8 ? "Pocket" : position >= track.total - 1e-8 ? "Writing"
      : position <= track.stroke ? "Pressing" : settle === 0 ? "Turning" : "Seating",
  };
}
