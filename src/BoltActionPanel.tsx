import { boltTrackPosition, type resolveBoltTrack } from "./boltTrack";
import "./boltAction.css";

type Props = {
  track: ReturnType<typeof resolveBoltTrack>;
  distance: number;
  tipExposure?: number;
  springSpace?: number;
  onMove: (position: number) => void;
  disabled: boolean;
};

export default function BoltActionPanel({ track, distance, tipExposure, springSpace, onMove, disabled }: Props) {
  const { angle, axial, state } = boltTrackPosition(track, distance);
  const x = 90 + 66 * axial / track.stroke;
  const y = 12 + 24 * angle / -track.turn;
  const endX = 24 + 66 * track.latch / track.stroke;
  const path = 'M90 12 H24 V36 H' + endX;
  return (
    <section className="bolt-action-card" aria-label="Bolt action">
      <header><h3>Bolt action</h3><strong>{state}</strong></header>
      <div className="bolt-action-track">
        <svg viewBox="12 1 90 47" role="img" aria-label={'J-slot position: ' + state}>
          <path d={path} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx={x} cy={y} r="4.2"/>
        </svg>
        <div>{tipExposure !== undefined &&
          <><b>{Math.abs(tipExposure).toFixed(2)} mm</b>
            <small>{tipExposure >= 0 ? "tip exposed" : "inside nose"}</small></>}
        </div>
      </div>
      <div className="joint-pair">
        <button type="button" aria-pressed={state === "Pocket"} disabled={disabled} onClick={() => onMove(0)}>Pocket</button>
        <button type="button" aria-pressed={state === "Writing"} disabled={disabled} onClick={() => onMove(track.total)}>Writing</button>
      </div>
      {springSpace !== undefined && <details>
        <summary>Return spring space</summary>
        <small>Seat spacing is {(springSpace + axial).toFixed(2)} mm here and {(springSpace - track.stroke).toFixed(2)} mm at full press. Choose a spring with a shorter solid height and verify its load in a prototype.</small>
      </details>}
      <small>Press forward, turn sideways, then release into the latch.</small>
    </section>
  );
}
