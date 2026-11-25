import { useState } from "react";
import { Modal } from "./Dialogs";
import {
  buildPoses,
  defaultJoint,
  type Joint,
  type JointConfig,
} from "./kinematics";
import {
  canKeepPlacement,
  findThread,
  resolveThreadMates,
  type ThreadFrame,
  type ThreadMate,
} from "./threadMates";
import type { EvaluatedFeature } from "./types";

type Props = {
  selected: string;
  bodies: EvaluatedFeature[];
  frames: ThreadFrame[];
  config: JointConfig;
  values: Record<string, number>;
  onClose: () => void;
  onApply: (joint: Joint) => void;
};
const key = (f: ThreadFrame) =>
  JSON.stringify([f.bodyId, f.featureId, f.finishId]);
const refOf = (f: ThreadFrame) => ({
  featureId: f.featureId,
  finishId: f.finishId,
});

export default function ThreadMateDialog({
  selected,
  bodies,
  frames,
  config,
  values,
  onClose,
  onApply,
}: Props) {
  const existing = config[selected] || defaultJoint(),
    link = existing.threadMate;
  const mine = frames.filter((f) => f.bodyId === selected),
    mates = frames.filter((f) => f.bodyId !== selected);
  const initialA =
    (link && findThread(frames, selected, link.moving)) || mine[0];
  const initialB =
    (link && findThread(frames, existing.parent, link.mating)) ||
    mates.find(
      (f) =>
        f.side !== initialA?.side &&
        f.hand === initialA?.hand &&
        Math.abs(f.pitch - initialA.pitch) < 1e-7,
    ) ||
    mates[0];
  const [aKey, A] = useState(initialA ? key(initialA) : ""),
    [bKey, B] = useState(initialB ? key(initialB) : "");
  const a = mine.find((f) => key(f) === aKey),
    b = mates.find((f) => key(f) === bKey);
  const [placement, P] = useState<ThreadMate["placement"]>(
    link?.placement ||
      (a && b && canKeepPlacement(a, b) ? "modeled" : "entrances"),
  );
  const [engagement, E] = useState(link?.engagement ?? "0 mm"),
    [phase, H] = useState(link?.phase ?? "0 deg");
  const [max, M] = useState(
      existing.kind === "screw" ? existing.max : "360 deg",
    ),
    [min, L] = useState(existing.kind === "screw" ? existing.min : "0 deg");
  const bodyName = (id: string) => bodies.find((f) => f.id === id)?.name || id;
  function option(f: ThreadFrame) {
    return (
      <option key={key(f)} value={key(f)}>
        {bodyName(f.bodyId)} · {f.name} · Ø{Number(f.diameter.toFixed(3))} ×{" "}
        {Number(f.pitch.toFixed(4))} mm
      </option>
    );
  }
  let candidate: Joint | undefined,
    problem = "";
  if (a && b) {
    candidate = {
      ...defaultJoint(),
      kind: "screw",
      parent: b.bodyId,
      axis: a.axis,
      pitch: String(a.pitch),
      hand: a.hand === "right" ? 1 : -1,
      min,
      max,
      threadMate: {
        moving: refOf(a),
        mating: refOf(b),
        placement,
        engagement,
        phase,
      },
    };
    try {
      const ids = bodies.map((f) => f.id),
        resolved = resolveThreadMates(
          { ...config, [selected]: candidate },
          frames,
          values,
          ids,
        );
      buildPoses(ids, resolved, {}, values);
    } catch (error) {
      problem = (error as Error).message;
    }
  } else
    problem =
      "Add a thread finish to the moving part and a mating thread to another part.";
  return (
    <Modal title="Mate threads" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (candidate && !problem) onApply(candidate);
        }}
      >
        <label>
          Moving thread
          <select value={aKey} onChange={(e) => A(e.target.value)}>
            {mine.map(option)}
          </select>
        </label>
        <label>
          Mating thread
          <select value={bKey} onChange={(e) => B(e.target.value)}>
            {mates.map(option)}
          </select>
        </label>
        <label>
          Zero-angle placement
          <select
            value={placement}
            onChange={(e) => P(e.target.value as ThreadMate["placement"])}
          >
            <option value="modeled">Keep modeled placement</option>
            <option value="entrances">Align entrances</option>
          </select>
        </label>
        {placement === "entrances" && (
          <label>
            Initial engagement
            <input value={engagement} onChange={(e) => E(e.target.value)} />
            <small>
              Positive distance seats the moving entrance inside the mating
              part.
            </small>
          </label>
        )}
        <div className="two-cols">
          <label>
            Minimum rotation
            <input value={min} onChange={(e) => L(e.target.value)} />
          </label>
          <label>
            Maximum rotation
            <input value={max} onChange={(e) => M(e.target.value)} />
          </label>
        </div>
        <details className="thread-phase">
          <summary>Starting phase</summary>
          <label>
            Initial rotation
            <input value={phase} onChange={(e) => H(e.target.value)} />
          </label>
        </details>
        {a && b && !problem && (
          <p className="helper">
            One turn advances {Number(a.pitch.toFixed(5))} mm. Pitch and hand
            follow both thread features.{" "}
            {a.mode === "cosmetic" || b.mode === "cosmetic"
              ? "Cosmetic threads have no solid flanks for a clearance check."
              : "Check clearance on the assembled solids after connecting."}
          </p>
        )}
        {problem && (
          <p role="alert" className="error-text">
            {problem}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!!problem}>
            Connect threads
          </button>
        </div>
      </form>
    </Modal>
  );
}
