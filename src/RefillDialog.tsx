import { useId, useMemo, useState } from "react";
import { Modal } from "./Dialogs";
import {
  isSleeveDonor,
  refillDimensionLabel,
  refillProfileData,
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
import ReverseRefillButton from "./ReverseRefillButton";

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

type AxialPoint = [number, number];
type Nose = { metal: number; seat: number; shankEnd: number };

function ProfileView({ outline, reversed, nose, detail = false }: {
  outline: AxialPoint[]; reversed: boolean; nose?: Nose; detail?: boolean;
}) {
  const id = useId();
  const length = outline[outline.length - 1][0];
  const extent = detail && nose ? Math.min(length, nose.shankEnd * 1.25) : length;
  const width = 448, height = detail ? 88 : 52;
  const mid = height / 2;
  const maxDiameter = Math.max(...outline.map(([, d]) => d));
  const scale = Math.min((width - 40) / extent, (height - (detail ? 40 : 16)) / maxDiameter);
  const start = (width - extent * scale) / 2;
  const x = (v: number) => reversed ? width - start - v * scale : start + v * scale;
  const path = [
    ...outline.map(([v, d]) => [x(v), mid - d * scale / 2]),
    ...outline.slice().reverse().map(([v, d]) => [x(v), mid + d * scale / 2]),
  ].map(pair => pair.join(",")).join(" ");
  const clipWidth = extent * scale;
  const clipStart = Math.min(x(0), x(extent));
  function segment(from: number, to: number, color: string) {
    return <rect x={Math.min(x(from), x(to))} y="0" width={Math.abs(x(from) - x(to))}
      height={height} fill={color}/>;
  }
  return <svg viewBox={`0 0 ${width} ${height}`} className="refill-silhouette"
      role="img" aria-label={detail ? "Enlarged tip and press-in shank with sleeve seating face" : "Tip-to-tail refill outline"}>
    <defs>
      <clipPath id={id + "outline"}><polygon points={path}/></clipPath>
      <clipPath id={id + "window"}><rect x={clipStart - 1} width={clipWidth + 2} height={height}/></clipPath>
      <linearGradient id={id + "light"} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fff" stopOpacity=".35"/>
        <stop offset="35%" stopColor="#fff" stopOpacity="0"/>
        <stop offset="100%" stopColor="#000" stopOpacity=".42"/>
      </linearGradient>
    </defs>
    <path d={`M8 ${mid}H440`} stroke="#566764" strokeDasharray="4 4"/>
    <g clipPath={`url(#${id}window)`}>
      <polygon points={path} fill={nose ? "#b5c5bf" : "#a8b8b8"} />
      {nose && <g clipPath={`url(#${id}outline)`}>
        {segment(0, nose.metal, "#c99a51")}
        {segment(nose.metal, nose.shankEnd, "#4b5558")}
      </g>}
      <polygon points={path} fill={`url(#${id}light)`} stroke="#adbbb6" strokeWidth=".8"/>
    </g>
    {detail && nose && <g fill="#eabe79" fontSize="11">
      <path d={`M${x(nose.seat)} 15 V${height - 7}`} stroke="#efba6d" strokeDasharray="3 2"/>
      <text x={x(nose.seat)} y="12" textAnchor="middle">Sleeve mouth</text>
      <text x={(x(nose.seat) + x(nose.shankEnd)) / 2} y={height - 3} textAnchor="middle">Shank</text>
    </g>}
  </svg>;
}

function ProfilePreview({ kind, inputs, project, reversed, onReverse, replaceBodyId }: {
  kind: RefillKind; inputs: RefillInputs; project: Project; reversed: boolean; onReverse: () => void; replaceBodyId?: string;
}) {
  const profile = useMemo(() => {
    try { return refillProfileData(kind, inputs, project, replaceBodyId); }
    catch { return undefined; }
  }, [inputs, kind, project, replaceBodyId]);
  return <figure className="refill-profile" aria-label={refillCatalog[kind].name + " axial profile"}>
    {profile ? <>
      <ProfileView outline={profile.outline} reversed={reversed} nose={profile.nose}/>
      {profile.nose && <div className="donor-detail"><ProfileView outline={profile.outline}
        nose={profile.nose} reversed={reversed} detail/></div>}
    </> : <p className="refill-profile-message">Enter valid donor dimensions to see the profile.</p>}
    <figcaption>
      {profile && <span>{Number(profile.outline[profile.outline.length - 1][0].toFixed(3))} mm overall</span>}
      <span>Tip toward {reversed ? "+X" : "−X"}</span>
      <ReverseRefillButton name="refill" reversed={reversed} onReverse={onReverse}/>
    </figcaption>
  </figure>;
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
  const [reversed, setReversed] = useState(!!starting?.reversed);
  const [mass, setMass] = useState(starting?.mass ?? "");
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  const entry = refillCatalog[kind];
  const keys = Object.keys(entry.fields) as RefillDimension[];
  const fullDonor = isSleeveDonor(kind);
  const primaryFields = fullDonor || kind === "bic-cristal" ? 4 : 3;
  const boltRefill = project.workspaces?.boltPen?.refillId;
  const fixedInCarrier = fullDonor && target && target === boltRefill;
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
    const label = refillDimensionLabel(kind, key);
    const provenance =
      inputs[key] && (seed === null || inputs[key] !== `${seed} mm`)
        ? "Custom"
        : origin;
    return (
      <label key={key} className="refill-field">
        <span>{label}</span>
        <input
          value={inputs[key] ?? ""}
          aria-label={label}
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
              reversed,
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
                setReversed(!!item?.reversed);
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
        {fixedInCarrier && <div className="refill-mount-choice">
          <p>This donor seats in a fixed sleeve. The bolt carrier holds a moving refill.</p>
          <button type="button" onClick={() => { setTarget(""); setReversed(false); setError(""); }}>Add as a separate part</button>
        </div>}
        <ProfilePreview kind={kind} inputs={inputs} project={project} replaceBodyId={target || undefined} reversed={reversed} onReverse={() => setReversed((v) => !v)} />
        <div className={"refill-field-grid" + (fullDonor ? " donor-fit-fields" : "")}>
          {keys.slice(0, primaryFields).map(field)}
        </div>
        <details
          className="refill-more"
          open={details}
          onToggle={(e) => setDetails(e.currentTarget.open)}
        >
          <summary>
            {fullDonor ? "Nose, ink tube and mass" : kind === "bic-cristal"
              ? "Filled refill mass"
              : "Shoulders, taper and mass"}
          </summary>
          <div className="refill-field-grid">
            {keys.slice(primaryFields).map(field)}
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
          <button className="primary" disabled={!!fixedInCarrier}>
            {target ? "Replace refill" : "Insert refill"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
