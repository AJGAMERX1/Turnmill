import { useRef, useState } from "react";

export default function InputValue({
  value,
  onCommit,
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(value),
    cancel = useRef(false);
  return (
    <input
      aria-label={label}
      spellCheck={false}
      value={editing ? draft : value}
      onFocus={(e) => {
        cancel.current = false;
        setDraft(value);
        setEditing(true);
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!cancel.current && editing && draft.trim() && draft !== value)
          onCommit(draft.trim());
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancel.current = true;
          setEditing(false);
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
