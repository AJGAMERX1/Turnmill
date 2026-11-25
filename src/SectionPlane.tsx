import type { SectionAxis } from "./secondaryProjection";
import { NumberField } from "./secondaryVector";

export default function SectionPlane({
  axis,
  offset,
  values,
  onChange,
}: {
  axis: SectionAxis;
  offset: string;
  values: Record<string, number>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <details>
      <summary>Section plane</summary>
      <label className="tm-field">
        <span>Cut perpendicular to</span>
        <select
          aria-label="Section direction"
          value={axis}
          onChange={(e) => onChange({ sectionAxis: e.target.value })}
        >
          <option value="Y">Y axis · front section</option>
          <option value="X">X axis · right section</option>
          <option value="Z">Z axis · top section</option>
        </select>
      </label>
      <NumberField
        title="Offset from body midpoint"
        expr={offset}
        values={values}
        unit="mm"
        onCommit={(v) => onChange({ sectionOffset: v })}
      />
    </details>
  );
}
