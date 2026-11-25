import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { evaluateModel } from "./buildModel";
import {
  isScaleFeature,
  scaleFaces,
  withScaleAttachment,
  type ScaleAttachment,
} from "./secondaryEngraving";
import { type WorkspaceProps } from "./secondaryVector";
import type { KernelReply } from "./Viewport";

export function ScaleAttachmentPanel({
  project,
  values,
  onChange,
  valid,
}: WorkspaceProps & { valid: boolean }) {
  const cfg = project.workspaces?.scale || {};
  const bodies = project.features.filter(
    (f) =>
      f.operation === "new" && !f.suppressed && !isScaleFeature(project, f.id),
  );
  const saved = cfg.attachment as ScaleAttachment | undefined;
  const initial: ScaleAttachment =
    saved && bodies.some((f) => f.id === saved.targetBodyId)
      ? saved
      : {
          targetBodyId: bodies[0]?.id ?? "",
          face: "top",
          u: "0 mm",
          v: "0 mm",
          angle: "0 deg",
        };
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const running = useRef<Worker | null>(null),
    rev = useRef(0);
  useEffect(() => {
    setDraft(initial);
  }, [saved, project.id, bodies[0]?.id]);
  useLayoutEffect(() => {
    setBusy(false);
    return () => {
      ++rev.current;
      running.current?.terminate();
      running.current = null;
    };
  }, [project]);
  const edit = (change: Partial<ScaleAttachment>) => {
    setDraft((prev) => ({ ...prev, ...change }));
    setStatus("");
    setError("");
  };
  async function apply() {
    const token = ++rev.current;
    setBusy(true);
    setError("");
    setStatus("");
    const finish = () => {
      running.current?.terminate();
      running.current = null;
      setBusy(false);
    };
    try {
      const next = withScaleAttachment(project, values, draft);
      const { features } = await evaluateModel(next);
      if (rev.current !== token) return;
      const start = features.findIndex((f) => f.id === draft.targetBodyId);
      const end = features.findIndex(
        (f, i) => i > start && f.operation === "new",
      );
      const worker = new Worker(new URL("./kernel.ts", import.meta.url), {
        type: "module",
        name: "turnmill-scale-placement",
      });
      running.current = worker;
      worker.onerror = () => {
        if (rev.current === token) {
          finish();
          setError(
            "The geometry engine stopped. Try applying the graduations again.",
          );
        }
      };
      worker.onmessage = ({ data }: MessageEvent<KernelReply>) => {
        if (rev.current !== token) return;
        if (data.type === "error") {
          finish();
          setError(data.message);
        }
        if (data.type === "built") {
          finish();
          setStatus("Engraved graduations saved to feature history.");
          onChange(next);
        }
      };
      worker.postMessage({
        type: "build",
        revision: token,
        // Moving the cut also changes any downstream features on its old body.
        features:
          saved && saved.targetBodyId !== draft.targetBodyId
            ? features
            : features.slice(start, end < 0 ? undefined : end),
      });
    } catch (e) {
      if (rev.current === token) {
        finish();
        setError((e as Error).message);
      }
    }
  }
  if (!bodies.length)
    return (
      <p className="tm-help">
        Open or create a part body to engrave an existing face.
      </p>
    );
  return (
    <fieldset
      disabled={busy}
      style={{ padding: 0, margin: "12px 0 0", border: 0, minWidth: 0 }}
    >
      <label className="tm-field">
        <span>Engrave part</span>
        <select
          aria-label="Engrave part"
          value={draft.targetBodyId}
          onChange={(e) => edit({ targetBodyId: e.target.value })}
        >
          {bodies.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="tm-field">
        <span>Flat face</span>
        <select
          aria-label="Flat face"
          value={draft.face}
          onChange={(e) =>
            edit({ face: e.target.value as ScaleAttachment["face"] })
          }
        >
          {Object.entries(scaleFaces).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="tm-pair">
        {(["u", "v"] as const).map((key) => (
          <label key={key} className="tm-field">
            <span>{key.toUpperCase() + " offset"}</span>
            <input
              value={draft[key]}
              onChange={(e) => edit({ [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="tm-field">
        <span>Layout rotation</span>
        <input
          value={draft.angle}
          onChange={(e) => edit({ angle: e.target.value })}
        />
      </label>
      <p className="tm-help">
        U and V follow the two axes shown for the face. Offsets start at the
        lower-left of the part bounds in that view.
      </p>
      <button
        className="tm-btn accent"
        disabled={!valid || busy}
        onClick={apply}
      >
        {busy
          ? "Checking placement…"
          : cfg.appliedId &&
              project.features.some((f) => f.id === cfg.appliedId)
            ? "Update engraved placement"
            : "Apply graduations to part"}
      </button>
      {error && (
        <p className="tm-inline-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="tm-help" role="status">
          {status}
        </p>
      )}
    </fieldset>
  );
}
