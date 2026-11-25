import { useState } from "react";
import type { FitSurface } from "./fitSurfaces";
import { fitClasses, fitLimits, type FitClass } from "./secondaryAssembly";
import type { Project } from "./types";
import { uid } from "./projects";
import "./matingFits.css";

type Attachment = {
  id: string;
  boreKey: string;
  shaftKey: string;
  code: FitClass;
  boreBody: string;
  shaftBody: string;
};
const mm = (n: number) => String(Number(n.toFixed(6)));
const signed = (value: number) => (value > 0 ? "+" + mm(value) : mm(value));
function describeSurface(s: FitSurface, name: string) {
  const axis = s.axis.findIndex((v) => Math.abs(v) > 1 - 1e-9);
  const label =
    axis < 0
      ? "axis (" + s.axis.map((x) => Number(x.toFixed(3))).join(", ") + ")"
      : ["X", "Y", "Z"][axis];
  const center = s.centerline
    .map((x, i) =>
      i === axis ? null : (axis < 0 ? "" : ["X", "Y", "Z"][i]) + mm(x),
    )
    .filter((x) => x !== null)
    .join(", ");
  return (
    name +
    " · Ø" +
    mm(s.diameter) +
    " · " +
    label +
    " " +
    mm(s.start) +
    "…" +
    mm(s.end) +
    (s.centerline.some((x) => Math.abs(x) > 1e-6) ? " · " + center : "")
  );
}
export function matingResult(
  bore: FitSurface | undefined,
  shaft: FitSurface | undefined,
  code: FitClass,
) {
  if (!bore || !shaft)
    return { error: "Choose a cylindrical bore and a shaft on another body." };
  if (
    bore.side !== "bore" ||
    shaft.side !== "shaft" ||
    bore.bodyId === shaft.bodyId
  )
    return { error: "Choose a bore and a shaft on different bodies." };
  if (Math.abs(bore.diameter - shaft.diameter) > 1e-6)
    return {
      error:
        "These diameters differ. Choose surfaces with the same nominal diameter, or edit their dimensions in Part.",
    };
  // Ignore sub-tolerance kernel roundoff at a size band boundary.
  const nominal = Number(bore.diameter.toFixed(6));
  const limits = fitLimits(nominal, code);
  return limits
    ? { limits, nominal }
    : { error: "Choose a basic diameter from 1 to 50 mm for this table." };
}
function FitReading({
  bore,
  shaft,
  code,
}: {
  bore?: FitSurface;
  shaft?: FitSurface;
  code: FitClass;
}) {
  const { limits, error, nominal } = matingResult(bore, shaft, code);
  if (!limits) return <p className="fit-hint">{error}</p>;
  return (
    <div className="fit-reading">
      <strong>
        {limits.kind} · Ø{mm(nominal!)} {code}
      </strong>
      <dl>
        <div>
          <dt>Diametral clearance</dt>
          <dd>
            {signed(limits.min)} … {signed(limits.max)} mm
          </dd>
        </div>
        <div>
          <dt>H7 bore limits</dt>
          <dd>
            {mm(limits.holeMin)} … {mm(limits.holeMax)} mm
          </dd>
        </div>
        <div>
          <dt>{code.slice(3)} shaft limits</dt>
          <dd>
            {mm(limits.shaftMin)} … {mm(limits.shaftMax)} mm
          </dd>
        </div>
      </dl>
      {limits.min < 0 && (
        <small>Negative clearance is diametral interference.</small>
      )}
    </div>
  );
}
export default function MatingFits({
  project,
  onChange,
  surfaces,
  loading = false,
}: {
  project: Project;
  onChange: (p: Project) => void;
  surfaces: FitSurface[];
  loading?: boolean;
}) {
  const raw = project.workspaces?.matingFits;
  const saved: Attachment[] = Array.isArray(raw)
    ? raw.filter(
        (r): r is Attachment =>
          r &&
          typeof r.id === "string" &&
          typeof r.boreKey === "string" &&
          typeof r.shaftKey === "string" &&
          fitClasses.includes(r.code),
      )
    : [];
  const [editing, setEditing] = useState<string | null>(null);
  const [boreKey, B] = useState(""),
    [shaftKey, S] = useState(""),
    [code, C] = useState<FitClass>("H7/g6");
  const names = new Map(project.features.map((f) => [f.id, f.name]));
  const find = (key: string) => surfaces.find((s) => s.key === key);
  const bore = find(boreKey),
    shaft = find(shaftKey);
  const bores = surfaces.filter((s) => s.side === "bore"),
    shafts = surfaces.filter(
      (s) => s.side === "shaft" && s.bodyId !== bore?.bodyId,
    );
  const change = (rows: Attachment[]) =>
    onChange({
      ...project,
      workspaces: { ...project.workspaces, matingFits: rows },
    });
  function edit(row?: Attachment) {
    setEditing(row?.id ?? "new");
    B(row?.boreKey ?? "");
    S(row?.shaftKey ?? "");
    C(row?.code ?? "H7/g6");
  }
  function save() {
    if (!bore || !shaft || !matingResult(bore, shaft, code).limits) return;
    const id = editing && editing !== "new" ? editing : uid();
    const next = {
      id,
      code,
      boreKey,
      shaftKey,
      boreBody: bore.bodyId,
      shaftBody: shaft.bodyId,
    };
    change(
      saved.some((s) => s.id === id)
        ? saved.map((s) => (s.id === id ? next : s))
        : [...saved, next],
    );
    setEditing(null);
  }
  const duplicate = saved.some(
    (s) => s.id !== editing && s.boreKey === boreKey && s.shaftKey === shaftKey,
  );
  const availablePair = bores.some((b) =>
    surfaces.some((s) => s.side === "shaft" && s.bodyId !== b.bodyId),
  );
  return (
    <details className="fit-panel">
      <summary>
        Mating fits{saved.length > 0 ? " (" + saved.length + ")" : ""}
      </summary>
      {loading && (
        <p role="status" className="fit-hint">
          Reading cylinder dimensions…
        </p>
      )}
      {!loading &&
        saved.map((row) => {
          const b = find(row.boreKey),
            s = find(row.shaftKey);
          return (
            <section className="fit-saved" key={row.id}>
              <div>
                {names.get(row.boreBody) ?? "Missing bore body"} /{" "}
                {names.get(row.shaftBody) ?? "Missing shaft body"}
              </div>
              {b && s ? (
                <FitReading bore={b} shaft={s} code={row.code} />
              ) : (
                <p className="fit-hint">
                  A referenced cylinder is missing. Edit the fit to choose its
                  replacement.
                </p>
              )}
              <div className="fit-actions">
                <button type="button" onClick={() => edit(row)}>
                  Edit fit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    change(saved.filter((x) => x.id !== row.id));
                    if (editing === row.id) setEditing(null);
                  }}
                >
                  Remove fit
                </button>
              </div>
            </section>
          );
        })}
      {!loading && !availablePair && (
        <p className="fit-hint">
          A fit needs a full cylindrical bore and a smooth shaft on different
          bodies. Add a straight hole or turned pilot in Part.
        </p>
      )}
      {!loading &&
        (editing === null ? (
          <button
            disabled={!availablePair}
            type="button"
            onClick={() => edit()}
          >
            Add mating fit
          </button>
        ) : (
          <div className="fit-editor">
            <label>
              Bore surface
              <select
                aria-label="Bore surface"
                value={bore?.key ?? ""}
                onChange={(e) => {
                  B(e.target.value);
                  if (find(e.target.value)?.bodyId === shaft?.bodyId) S("");
                }}
              >
                <option value="">Choose bore</option>
                {bores.map((s) => (
                  <option key={s.key} value={s.key}>
                    {describeSurface(s, names.get(s.bodyId) ?? "Body")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Shaft surface
              <select
                aria-label="Shaft surface"
                value={shaft?.key ?? ""}
                onChange={(e) => S(e.target.value)}
              >
                <option value="">Choose shaft</option>
                {shafts.map((s) => (
                  <option key={s.key} value={s.key}>
                    {describeSurface(s, names.get(s.bodyId) ?? "Body")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ISO 286 fit
              <select
                aria-label="ISO 286 fit"
                value={code}
                onChange={(e) => C(e.target.value as FitClass)}
              >
                {fitClasses.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <FitReading bore={bore} shaft={shaft} code={code} />
            {duplicate && (
              <p className="fit-hint">
                This pair already has a fit. Edit its saved entry.
              </p>
            )}
            <div className="fit-actions">
              <button
                type="button"
                disabled={!matingResult(bore, shaft, code).limits || duplicate}
                onClick={save}
              >
                Apply fit
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ))}
      <p className="fit-hint">
        Select smooth cylindrical features of the same basic size. The limits
        describe diameter tolerances. Use Clearance to check the assembled
        positions.
      </p>
      <a
        href="https://www.schaeffler.it/remotemedien/media/_shared_media/08_media_library/01_publications/schaeffler_2/catalogue_1/downloads_6/hg_1_de_en.pdf"
        target="_blank"
        rel="noreferrer"
      >
        Tolerance tables · Schaeffler
      </a>
    </details>
  );
}
