import { UnfoldHorizontal } from "lucide-react";
import "./penExplodeControls.css";

type Props = {
  exploded: boolean;
  gap: number;
  onToggle: () => void;
  onGapChange: (millimetres: number) => void;
  disabled?: boolean;
  disabledReason?: string;
};

export default function PenExplodeControls({ exploded, gap, onToggle, onGapChange, disabled, disabledReason }: Props) {
  return <div className="pen-explode-controls">
    <button type="button" aria-pressed={exploded} onClick={onToggle} disabled={disabled && !exploded}
      title={disabled && !exploded ? disabledReason : undefined}>
      <UnfoldHorizontal size={15} aria-hidden="true"/>Exploded view
    </button>
    {exploded && <label className="pen-explode-gap">
      Gap
      <input type="range" aria-label="Exploded view spacing" aria-valuetext={gap + " millimetres"}
        min={1} max={40} step={1} value={gap} disabled={disabled}
        onChange={e => onGapChange(e.currentTarget.valueAsNumber)}/>
      <span aria-hidden="true">{gap} mm</span>
    </label>}
  </div>;
}
