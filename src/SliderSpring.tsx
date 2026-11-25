import { useState } from "react";
import type { Joint } from "./kinematics";
import { springReading, type CompressionSpring } from "./springForce";

type Props = {
  joint: Joint;
  position: number;
  values: Record<string, number>;
  onChange: (spring: CompressionSpring | undefined) => void;
};
const defaults: CompressionSpring = {
  zero: "0 mm",
  preload: "0.6 N",
  stiffness: "0.7 N/mm",
  maxCompression: "6 mm",
  direction: 1,
};
export default function SliderSpring(props: Props) {
  const { joint, position, values } = props;
  if (joint.kind !== "slider" || joint.cam) return null;
  let reading,
    error = "";
  if (joint.spring) {
    try {
      reading = springReading(joint.spring, position, values);
      error = reading.error;
    } catch (cause) {
      error = (cause as Error).message;
    }
  }
  return (
    <details className="slider-spring">
      <summary>
        Compression spring
        {reading && !error ? ` · ${reading.force.toFixed(3)} N` : ""}
      </summary>
      {reading && (
        <dl aria-label="Slider spring measurements">
          <div>
            <dt>Compression</dt>
            <dd>{reading.compression.toFixed(3)} mm</dd>
          </div>
          <div>
            <dt>Axial force on slider ({joint.axis})</dt>
            <dd>{error ? "—" : reading.restoringForce.toFixed(3) + " N"}</dd>
          </div>
        </dl>
      )}
      {error && <p className="error-text">{error}</p>}
      <SpringForm {...props} key={JSON.stringify(joint.spring)} />
    </details>
  );
}
function SpringForm({ joint, values, position, onChange }: Props) {
  const [draft, setDraft] = useState(joint.spring || defaults),
    [error, setError] = useState("");
  const fields = [
    ["zero", "Reference position"],
    ["preload", "Preload at reference"],
    ["stiffness", "Spring stiffness"],
    ["maxCompression", "Maximum compression"],
  ] as const;
  function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = springReading(draft, position, values);
      if (result.error) throw Error(result.error);
      setError("");
      onChange(draft);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <form onSubmit={save}>
      <p className="helper">
        The spring acts between the slider and its parent. Enter the installed
        preload at the reference position.
      </p>
      <div className="joint-pair">
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              aria-label={label}
              value={draft[key]}
              onChange={(e) => {
                setError("");
                setDraft({ ...draft, [key]: e.target.value });
              }}
            />
          </label>
        ))}
      </div>
      <label>
        Compression direction
        <select
          aria-label="Compression direction"
          value={draft.direction}
          onChange={(e) => {
            setError("");
            setDraft({ ...draft, direction: Number(e.target.value) as 1 | -1 });
          }}
        >
          <option value={1}>Positive {joint.axis}</option>
          <option value={-1}>Negative {joint.axis}</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="cam-coupling-actions">
        <button type="submit" className="outline-btn">
          {joint.spring ? "Update spring" : "Add spring"}
        </button>
        {joint.spring && (
          <button
            type="button"
            className="outline-btn"
            onClick={() => onChange(undefined)}
          >
            Remove spring
          </button>
        )}
      </div>
    </form>
  );
}
