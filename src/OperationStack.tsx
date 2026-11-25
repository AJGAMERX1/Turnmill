import { useState } from "react";
import { Modal } from "./Dialogs";
import AdvancedDialog from "./AdvancedDialog";
import { advancedLabels, type Advanced } from "./advancedTypes";
import type { Project, Feature, OperationEntry } from "./types";
export function operationsOf(f: Feature): OperationEntry[] {
  return (
    f.operations ??
    (f.advanced
      ? [
          {
            id: f.id + "-advanced",
            name: advancedLabels[f.advanced.kind],
            suppressed: false,
            operation: f.advanced,
          },
        ]
      : [])
  );
}
type Props = {
  project: Project;
  feature: Feature;
  initialKind?: Advanced["kind"];
  entryId?: string;
  onSave: (next: Feature) => void;
  onClose: () => void;
};
export default function OperationStack({
  feature,
  project,
  initialKind,
  entryId,
  onSave,
  onClose,
}: Props) {
  const initial = operationsOf(feature),
    [entry, setEntry] = useState<string | undefined>(
      initialKind || !initial.length ? "new" : entryId,
    );
  const [rows, setRows] = useState(initial);
  const selected = rows.find((r) => r.id === entry);
  function save(rows: OperationEntry[]) {
    onSave({ ...feature, operations: rows, advanced: undefined });
  }
  if (entry)
    return (
      <AdvancedDialog
        feature={{ ...feature, advanced: selected?.operation }}
        initialKind={initialKind}
        project={project}
        onClose={onClose}
        onSave={(op) => {
          if (!op) {
            save(rows.filter((r) => r.id !== entry));
            return;
          }
          const row = {
            id: selected?.id || crypto.randomUUID(),
            name: selected?.name || advancedLabels[op.kind],
            suppressed: selected?.suppressed || false,
            operation: op,
          };
          save(
            selected
              ? rows.map((r) => (r.id === entry ? row : r))
              : [...rows, row],
          );
        }}
      />
    );
  return (
    <Modal title="Advanced operations" onClose={onClose}>
      <div className="operation-stack">
        {rows.map((row, i) => (
          <div key={row.id}>
            <input
              aria-label={"Name for " + row.name}
              value={row.name}
              onChange={(e) =>
                setRows(
                  rows.map((r) =>
                    r.id === row.id ? { ...r, name: e.target.value } : r,
                  ),
                )
              }
            />
            <button onClick={() => setEntry(row.id)}>Edit</button>
            <button
              title="Move earlier"
              disabled={!i}
              onClick={() => {
                const next = [...rows];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                setRows(next);
              }}
            >
              ↑
            </button>
            <button
              title="Move later"
              disabled={i === rows.length - 1}
              onClick={() => {
                const next = [...rows];
                [next[i], next[i + 1]] = [next[i + 1], next[i]];
                setRows(next);
              }}
            >
              ↓
            </button>
            <button
              onClick={() =>
                setRows(
                  rows.map((r) =>
                    r.id === row.id ? { ...r, suppressed: !r.suppressed } : r,
                  ),
                )
              }
            >
              {row.suppressed ? "Restore" : "Suppress"}
            </button>
          </div>
        ))}
      </div>
      <button className="text-btn" onClick={() => setEntry("new")}>
        Add operation
      </button>
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => save(rows)}>
          Apply history
        </button>
      </div>
    </Modal>
  );
}
