import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./Dialogs";
import { evaluate, resolveParameters } from "./expressions";
import {
  dimensionLabels,
  insertRefill,
  refillCatalog,
  refillComponents,
  refillDefaults,
  type RefillComponent,
  type RefillDimension,
  type RefillInputs,
  type RefillKind,
} from "./refills";
import type { Project } from "./types";
import "./refills.css";

function storedInputs(project: Project, item: RefillComponent): RefillInputs {
  const params = new Map(project.parameters.map((p) => [p.name, p.expression]));
  const defaults = refillDefaults(item.kind);
  return Object.fromEntries(
    Object.entries(defaults).map(([key, seed]) => [
      key,
      params.get(`${item.prefix}_${key}`) ?? seed,
    ]),
  );
}

// A scaled axial profile makes the tip datum and shoulder visible while entering measurements.
function ProfilePreview({
  kind,
  inputs,
  project,
}: {
  kind: RefillKind;
  inputs: RefillInputs;
  project: Project;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const d = useMemo(() => {
    try {
      const params = resolveParameters(project.parameters);
      const dims = Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [k, evaluate(v, params)]),
      );
      return Object.values(dims).every((n) => n > 0) ? dims : null;
    } catch {
      return null;
    }
  }, [inputs, project.parameters]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    function draw() {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const width = canvas.clientWidth,
        height = canvas.clientHeight,
        ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, width, height);
      const left = 23,
        right = width - 23,
        mid = height / 2 + 2;
      ctx.strokeStyle = "#697a7c";
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(6, mid);
      ctx.lineTo(width - 6, mid);
      ctx.stroke();
      ctx.setLineDash([]);
      // The empty donor form gets an explicitly captioned proportional schematic.
      const v = d ?? {
        length: 100,
        body_diameter: 4,
        guide_diameter: 2,
        shoulder_distance: 8,
      };
      const x = (mm: number) => left + ((right - left) * mm) / v.length;
      const y = (diameter: number) =>
        (Math.min((right - left) / v.length, 5) * diameter) / 2;
      const shoulder = v.shoulder_distance,
        start = v.body_start ?? shoulder;
      const outline = [
        [0, 0],
        [v.cone_length ?? shoulder / 2, v.guide_diameter],
        [shoulder, v.guide_diameter],
      ];
      if (kind !== "bic-cristal")
        outline.push(
          [shoulder, v.neck_diameter ?? v.guide_diameter],
          [start, v.neck_diameter ?? v.guide_diameter],
        );
      if (kind === "parker-g2" && v.reservoir_taper)
        outline.push(
          [start, v.reservoir_front_diameter],
          [start + v.reservoir_taper, v.body_diameter],
        );
      else outline.push([start, v.body_diameter]);
      if (kind === "parker-g2" && v.tail_length)
        outline.push(
          [v.length - v.tail_length, v.body_diameter],
          [v.length - v.tail_length, v.tail_diameter],
        );
      outline.push([v.length, v.tail_diameter ?? v.body_diameter]);
      ctx.beginPath();
      outline.forEach(([ax, dia], i) => {
        if (!i) ctx.moveTo(x(ax), mid - y(dia));
        else ctx.lineTo(x(ax), mid - y(dia));
      });
      for (const [ax, dia] of [...outline].reverse())
        ctx.lineTo(x(ax), mid + y(dia));
      ctx.closePath();
      const radius = Math.max(
        1,
        y(Math.max(v.body_diameter, v.tail_diameter ?? 0)),
      );
      const gradient = ctx.createLinearGradient(
        0,
        mid - radius,
        0,
        mid + radius,
      );
      gradient.addColorStop(0, "#657071");
      gradient.addColorStop(0.28, "#e1e9e6");
      gradient.addColorStop(0.58, "#92a5a7");
      gradient.addColorStop(0.9, "#445657");
      gradient.addColorStop(1, "#a0adad");
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = "#c0cbca";
      ctx.stroke();
      ctx.strokeStyle = "#d9a860";
      ctx.beginPath();
      ctx.moveTo(left, mid + 3);
      ctx.lineTo(left, height - 13);
      ctx.stroke();
      ctx.fillStyle = "#ebc086";
      ctx.font = "10px monospace";
      ctx.fillText("X 0", left + 4, height - 12);
    }
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [kind, d]);
  return (
    <figure className="refill-profile">
      <canvas
        ref={ref}
        role="img"
        aria-label={`${refillCatalog[kind].name} axial profile. Writing point at X zero, tube extends toward positive X.`}
      />
      <figcaption>
        {d ? `${Number(d.length.toFixed(3))} mm overall` : "Profile schematic"}{" "}
        <span>Writing point at X = 0</span>
      </figcaption>
    </figure>
  );
}

type Props = {
  project: Project;
  onSave: (next: Project, bodyId: string) => void;
  onClose: () => void;
};
export default function RefillDialog({ project, onSave, onClose }: Props) {
  const installed = refillComponents(project);
  const starting = installed.find(
    (item) => item.bodyId === project.workspaces?.boltPen?.refillId,
  );
  const [target, setTarget] = useState(starting?.bodyId ?? "");
  const [kind, setKind] = useState<RefillKind>(starting?.kind ?? "parker-g2");
  const [inputs, setInputs] = useState<RefillInputs>(() =>
    starting ? storedInputs(project, starting) : refillDefaults(kind),
  );
  const [mass, setMass] = useState(starting?.mass ?? "");
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const entry = refillCatalog[kind];
  const keys = Object.keys(entry.fields) as RefillDimension[];
  function chooseKind(next: RefillKind, selected = target) {
    const same = installed.find(
      (r) => r.bodyId === selected && r.kind === next,
    );
    setKind(next);
    setInputs(same ? storedInputs(project, same) : refillDefaults(next));
    setMass(same?.mass ?? (next === "energel-lr7" ? "2.6" : ""));
    setError("");
    setDetails(false);
  }
  function field(key: RefillDimension) {
    const [seed, origin] = entry.fields[key]!;
    const provenance =
      inputs[key] && (seed === null || inputs[key] !== `${seed} mm`)
        ? "Custom"
        : origin;
    return (
      <label key={key} className="refill-field">
        <span>{dimensionLabels[key]}</span>
        <input
          value={inputs[key] ?? ""}
          aria-label={dimensionLabels[key]}
          placeholder="Measure in mm"
          required
          onChange={(e) => {
            setInputs({ ...inputs, [key]: e.target.value });
            setError("");
          }}
        />
        <small>{provenance}</small>
      </label>
    );
  }
  return (
    <Modal title="Refill library" onClose={onClose} className="refill-dialog">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const result = insertRefill(project, kind, inputs, {
              replaceBodyId: target || undefined,
              mass,
            });
            onSave(result.project, result.bodyId);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {installed.length > 0 && (
          <label>
            Placement
            <select
              aria-label="Refill placement"
              value={target}
              onChange={(e) => {
                const id = e.target.value;
                setTarget(id);
                const item = installed.find((r) => r.bodyId === id);
                chooseKind(item?.kind ?? kind, id);
              }}
            >
              <option value="">Add as a new part</option>
              {installed.map((item) => (
                <option key={item.bodyId} value={item.bodyId}>
                  Replace{" "}
                  {project.features.find((f) => f.id === item.bodyId)?.name} ·{" "}
                  {item.prefix}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Refill family
          <select
            value={kind}
            aria-label="Refill family"
            onChange={(e) => chooseKind(e.target.value as RefillKind)}
          >
            {Object.entries(refillCatalog).map(([value, e]) => (
              <option key={value} value={value}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <p className="refill-variant">{entry.description}</p>
        <ProfilePreview kind={kind} inputs={inputs} project={project} />
        <div className="refill-field-grid">
          {keys.slice(0, kind === "bic-cristal" ? 4 : 3).map(field)}
        </div>
        <details
          className="refill-more"
          open={details}
          onToggle={(e) => setDetails(e.currentTarget.open)}
        >
          <summary>
            {kind === "bic-cristal"
              ? "Filled refill mass"
              : "Shoulders, taper and mass"}
          </summary>
          <div className="refill-field-grid">
            {keys.slice(kind === "bic-cristal" ? 4 : 3).map(field)}
            <label className="refill-field">
              <span>Filled mass (g)</span>
              <input
                aria-label="Filled mass in grams"
                placeholder="Weigh the refill"
                value={mass}
                onChange={(e) => setMass(e.target.value)}
              />
              <small>
                {kind === "energel-lr7" && mass === "2.6"
                  ? "Data sheet"
                  : "Optional"}
              </small>
            </label>
          </div>
        </details>
        <p className="refill-guidance">{entry.guidance}</p>
        <details className="refill-sources">
          <summary>Dimension sources</summary>
          {entry.sources.map(([label, url]) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {label} ↗
            </a>
          ))}
        </details>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">
            {target ? "Replace refill" : "Insert refill"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
