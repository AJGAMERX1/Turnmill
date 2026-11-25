import { useEffect, useRef, useState } from "react";
import { Modal } from "./Dialogs";
import { evaluate, resolveParameters } from "./expressions";
import {
  hardwareNames,
  hardwareSizes,
  hardwareSources,
  insertHardware,
  stockSpring,
  type HardwareKind,
} from "./hardware";
import type { Project } from "./types";
import { uid } from "./projects";
type Props = {
  project: Project;
  onSave: (p: Project) => void;
  onClose: () => void;
};
export default function HardwareDialog({ project, onSave, onClose }: Props) {
  const [kind, setKind] = useState<HardwareKind>("screw"),
    [index, select] = useState(0),
    [length, L] = useState("12 mm"),
    [mode, M] = useState<"modeled" | "cosmetic">("cosmetic");
  const [od, D] = useState("5 mm"),
    [wire, W] = useState("0.5 mm"),
    [turns, T] = useState("8"),
    [busy, setBusy] = useState(false),
    [error, E] = useState("");
  const [springSku, setSpringSku] = useState("custom");
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const source = hardwareSources[kind],
    row = hardwareSizes[index];
  function submit() {
    try {
      E("");
      if (kind !== "spring") {
        onSave(insertHardware(project, kind, index, length, mode));
        return;
      }
      const v = resolveParameters(project.parameters),
        dims = {
          od: evaluate(od, v),
          wire: evaluate(wire, v),
          length: evaluate(length, v),
          turns: evaluate(turns, v, "scalar"),
        };
      setBusy(true);
      const w = new Worker(new URL("./springWorker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = w;
      w.onmessage = async ({ data }) => {
        w.terminate();
        worker.current = null;
        try {
          if (data.error) throw Error(data.error);
          const file = new Uint8Array(await (data.file as Blob).arrayBuffer());
          const name =
              springSku !== "custom"
                ? stockSpring.name
                : "Coil spring Ø" + dims.od + " × " + dims.length + " mm",
            sourceId = uid(),
            featureId = uid();
          let binary = "";
          for (let i = 0; i < file.length; i += 8192)
            binary += String.fromCharCode(...file.subarray(i, i + 8192));
          onSave({
            ...project,
            workspaces: {
              ...project.workspaces,
              hardwareComponents: {
                ...project.workspaces?.hardwareComponents,
                [featureId]: {
                  source:
                    springSku === "custom"
                      ? "Custom coil spring"
                      : stockSpring.name,
                  specification: `OD ${+dims.od.toFixed(6)} mm · wire ${+dims.wire.toFixed(6)} mm · free length ${+dims.length.toFixed(6)} mm · ${dims.turns} turns`,
                },
              },
              bodyMaterials: {
                ...project.workspaces?.bodyMaterials,
                [featureId]: "Steel",
              },
            },
            importedFiles: [
              ...(project.importedFiles || []),
              {
                id: sourceId,
                name: name + ".step",
                format: "step",
                data: btoa(binary),
                bodies: [{ name, brep: data.brep }],
              },
            ],
            features: [
              ...project.features,
              {
                id: featureId,
                kind: "import",
                name,
                sourceId,
                sourceIndex: 0,
                sketchId: "",
                amount: "0",
                operation: "new",
                suppressed: false,
              },
            ],
          });
        } catch (e) {
          E((e as Error).message);
          setBusy(false);
        }
      };
      w.onerror = () => {
        w.terminate();
        setBusy(false);
        E("The spring modeler stopped. Reopen the library and try again.");
      };
      w.postMessage(dims);
    } catch (e) {
      E((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Hardware library" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label>
          Component
          <select
            aria-label="Component"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as HardwareKind);
              E("");
            }}
          >
            {Object.entries(hardwareNames).map(([k, n]) => (
              <option value={k} key={k}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {kind !== "spring" && (
          <label>
            Nominal size
            <select
              aria-label="Nominal size"
              value={index}
              onChange={(e) => select(+e.target.value)}
            >
              {hardwareSizes.map((r, i) => (
                <option value={i} key={i}>
                  {kind === "oring"
                    ? "2-00" + (6 + i) + " · " + r[8] + " × 1.78 mm"
                    : kind === "pin"
                      ? "Ø " + r[0] + " mm"
                      : "M" + r[0]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "spring" && (
          <label>
            Spring size
            <select
              aria-label="Spring size"
              value={springSku}
              onChange={(e) => {
                setSpringSku(e.target.value);
                if (e.target.value !== "custom") {
                  D(stockSpring.od);
                  W(stockSpring.wire);
                  L(stockSpring.length);
                  T(stockSpring.turns);
                }
              }}
            >
              <option value="custom">Custom open-end spring</option>
              <option value="B18-127CS">{stockSpring.name}</option>
            </select>
          </label>
        )}
        {(kind === "pin" || kind === "screw" || kind === "spring") && (
          <label>
            {kind === "spring" ? "Free length" : "Length"}
            <input
              value={length}
              onChange={(e) => {
                L(e.target.value);
                setSpringSku("custom");
              }}
              required
            />
          </label>
        )}
        {(kind === "nut" || kind === "screw") && (
          <>
            <label>
              Thread detail
              <select
                aria-label="Thread detail"
                value={mode}
                onChange={(e) => M(e.target.value as typeof mode)}
              >
                <option value="cosmetic">Cosmetic</option>
                <option value="modeled">Modeled</option>
              </select>
            </label>
            <p className="helper">
              {row[2]} mm across flats · {row[1]} mm pitch · nominal envelope,
              without thread fit allowance.
            </p>
          </>
        )}
        {kind === "washer" && (
          <p className="helper">
            Ø {row[5]} mm bore · Ø {row[6]} mm outside · {row[7]} mm thick.
          </p>
        )}
        {kind === "spring" && (
          <>
            <div className="two-cols">
              <label>
                Outside diameter
                <input
                  value={od}
                  onChange={(e) => {
                    D(e.target.value);
                    setSpringSku("custom");
                  }}
                />
              </label>
              <label>
                Wire diameter
                <input
                  value={wire}
                  onChange={(e) => {
                    W(e.target.value);
                    setSpringSku("custom");
                  }}
                />
              </label>
            </div>
            <label>
              Turns
              <input
                value={turns}
                onChange={(e) => {
                  T(e.target.value);
                  setSpringSku("custom");
                }}
              />
            </label>
            <p className="helper">
              Creates a free-state helical reference body with open ends.
              Specify axial spring behavior separately in the assembly.
            </p>
          </>
        )}
        {kind === "spring" && springSku !== "custom" && (
          <p className="helper">
            <a href={stockSpring.source} target="_blank" rel="noreferrer">
              MW Components · spring specification
            </a>
          </p>
        )}
        {source && (
          <p className="helper">
            <a href={source[1]} target="_blank" rel="noreferrer">
              {source[0]}
            </a>
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Building spring…" : "Insert component"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
