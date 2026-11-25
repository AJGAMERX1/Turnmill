import { useEffect, useState } from "react";
import { evaluate } from "./expressions";
import type { ExplosionAxis } from "./assemblyExplosion";

export default function ExplosionControls({
  axis,
  gap,
  values,
  onChange,
}: {
  axis: ExplosionAxis;
  gap: string;
  values: Record<string, number>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(gap),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(gap);
    setError("");
  }, [gap]);
  function commit() {
    if (draft.trim() === gap) return;
    try {
      if (draft.trim() && !(evaluate(draft, values) > 0))
        throw Error(
          "Enter a positive gap, or clear the field for automatic spacing.",
        );
      setError("");
      onChange({ explodeGap: draft.trim() });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <details>
      <summary>Exploded view</summary>
      <label className="tm-field">
        <span>Explosion direction</span>
        <select
          aria-label="Explosion direction"
          value={axis}
          onChange={(e) => onChange({ explodeAxis: e.target.value })}
        >
          <option value="joints">Joint directions</option>
          {["X", "Y", "Z"].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      <label className="tm-field">
        <span>Minimum projected gap</span>
        <span className="tm-number">
          <input
            aria-label="Minimum projected gap"
            placeholder="Automatic"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(gap);
                setError("");
              }
            }}
          />
          <small>mm</small>
        </span>
      </label>
      {error && (
        <p role="alert" className="tm-inline-error">
          {error}
        </p>
      )}
    </details>
  );
}
