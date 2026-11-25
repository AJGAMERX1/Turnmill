import { useEffect, useRef, useState } from "react";
import { Boxes, Download, Pause, Play, RotateCcw, Disc3 } from "lucide-react";
import { evaluate } from "./expressions";
import {
  changeWorkspace,
  fileName,
  n,
  NumberField,
  saveAs,
  type WorkspaceProps,
  type XY,
} from "./secondaryVector";
import {
  maxRadiusInBand,
  fitLimits,
  fitClasses,
  type FitClass,
} from "./secondaryAssembly";
import AssemblyBom from "./AssemblyBom";

export default function Assembly(props: WorkspaceProps) {
  const { project, values, features } = props;
  const cfg = project.workspaces?.assembly || {};
  const source = features.find(
    (f) =>
      f.operation === "new" &&
      f.kind === "revolve" &&
      Math.abs(Math.abs(f.amount) - 360) < 1e-7,
  );
  if (!source)
    return (
      <div className="tm-empty">
        <Boxes size={34} />
        <h2>Start a turned assembly</h2>
        <p>
          Create a 360° revolve, or open the twist pen example to study a cap
          and refill.
        </p>
      </div>
    );
  const memberIndex = features.indexOf(source);
  const nextIndex = features
    .slice(memberIndex + 1)
    .findIndex((f) => f.operation === "new");
  const hasBodyEdits =
    (nextIndex === -1
      ? features.slice(memberIndex + 1)
      : features.slice(memberIndex + 1, memberIndex + 1 + nextIndex)
    ).length > 0;
  return (
    <AssemblyStudy
      key={project.id}
      {...props}
      source={source.points}
      sourceName={source.name}
      cfg={cfg}
      hasBodyEdits={
        hasBodyEdits ||
        !!source.advanced ||
        !!source.operations?.length ||
        !!source.finishes?.some((f) => !f.suppressed) ||
        !!source.edges?.some((e) => e.through)
      }
      pitchExpr={String(
        cfg.pitch ?? ("thread_pitch" in values ? "thread_pitch" : "0.75 mm"),
      )}
    />
  );
}
type StudyProps = WorkspaceProps & {
  source: XY[];
  sourceName: string;
  cfg: Record<string, any>;
  hasBodyEdits: boolean;
  pitchExpr: string;
};
function AssemblyStudy(props: StudyProps) {
  const { cfg, source, sourceName, values, pitchExpr } = props;
  const patch = (data: Record<string, unknown>) =>
    changeWorkspace(props, "assembly", data);
  const [joint, setJoint] = useState<"cap" | "refill">("cap");
  const [cap, setCap] = useState(0),
    [refill, setRefill] = useState(0),
    [playing, play] = useState(false);
  const [exploded, explode] = useState(false);
  const [recording, record] = useState(false),
    [recordCount, setRecordCount] = useState(0);
  const recordingRef = useRef<
    { time: number; angle: number; cap: number; refill: number }[]
  >([]);
  const startTime = useRef(0),
    stage = useRef<SVGSVGElement>(null),
    drag = useRef<{ x: number; f: number; id: number } | null>(null);
  const minX = Math.min(...source.map((p) => p[0])),
    maxX = Math.max(...source.map((p) => p[0]));
  const len = maxX - minX,
    outer = Math.max(...source.map((p) => Math.abs(p[1])));
  const shoulderExpr = String(
    cfg.seat ??
      ("shoulder_length" in values ? "shoulder_length" : n(len * 0.12)),
  );
  const slideExpr = String(cfg.stroke ?? "4 mm"),
    turnExpr = String(cfg.turns ?? "2"),
    startExpr = String(cfg.starts ?? "1");
  const shaftTolExpr = String(cfg.shaftTol ?? "0.015 mm"),
    boreTolExpr = String(cfg.boreTol ?? "0.015 mm");
  let pitch = 0,
    stroke = 0,
    engage = 0,
    turns = 0,
    starts = 0,
    bore = 0,
    shaftTol = 0,
    boreTol = 0,
    problem = "";
  const side = cfg.hand === "left" ? -1 : 1;
  let defaultDiameter = outer * 2;
  try {
    pitch = evaluate(pitchExpr, values);
    starts = evaluate(startExpr, values, "scalar");
    turns = evaluate(turnExpr, values, "scalar");
    stroke = evaluate(slideExpr, values);
    engage = evaluate(shoulderExpr, values);
    if (
      !(
        pitch > 0 &&
        starts >= 1 &&
        Number.isInteger(starts) &&
        turns > 0 &&
        stroke >= 0 &&
        engage > 0 &&
        engage < len
      )
    )
      throw Error(
        "Use positive pitch, turns, and whole thread starts. Set engagement below barrel length.",
      );
    // Leave the butt shoulder in intentional axial contact only at seating.
    // The slightly relieved seat avoids counting the shoulder's vertical end face as a cylindrical pilot.
    const zoneStart = maxX - engage + Math.min(0.02, engage / 100);
    defaultDiameter = (maxRadiusInBand(source, zoneStart, maxX) ?? outer) * 2;
    if (cfg.fit !== "iso") {
      bore = evaluate(String(cfg.capId ?? n(defaultDiameter + 0.1, 8)), values);
      shaftTol = evaluate(shaftTolExpr, values);
      boreTol = evaluate(boreTolExpr, values);
      if (!(bore > 0 && boreTol >= 0 && shaftTol >= 0 && bore > boreTol))
        throw Error(
          "Cap bore must be positive and larger than its tolerance. Enter nonnegative diameter tolerances.",
        );
    }
  } catch (e) {
    problem = (e as Error).message;
  }
  const fitCode: FitClass = fitClasses.includes(cfg.fitClass)
    ? cfg.fitClass
    : "H7/g6";
  const fit =
    cfg.fit === "iso"
      ? fitLimits(Number(defaultDiameter.toFixed(6)), fitCode)
      : null;
  if (cfg.fit === "iso" && !fit)
    problem =
      "The ISO fit table supports basic diameters from 1 through 50 mm. Choose custom limits for this size.";
  const capID = fit ? fit.holeMin : bore;
  const seat = maxX - engage + Math.min(0.02, engage / 100),
    sleeve = engage + 2;
  const lead = pitch * starts * side,
    capX = cap * turns * Math.abs(lead),
    angle = cap * turns * 360 * side,
    refillX = stroke * refill;
  const nominal = fit ? 0 : capID - defaultDiameter,
    worstMin = fit ? fit.min : nominal - shaftTol - boreTol,
    worstMax = fit ? fit.max : nominal + shaftTol + boreTol;
  const dataOK = !problem && !props.hasBodyEdits;
  const animated = joint === "cap" ? cap : refill;
  function pose(f: number) {
    const step = Math.min(1, Math.max(0, f));
    if (joint === "cap") setCap(step);
    else setRefill(step);
  }
  useEffect(() => {
    if (!playing || problem) return;
    let id = 0,
      last = performance.now(),
      fraction = animated,
      dir = animated >= 1 ? -1 : 1;
    function frame(now: number) {
      fraction += (dir * (now - last)) / 2500;
      last = now;
      if (fraction > 1) {
        fraction = 1;
        dir = -1;
      } else if (fraction < 0) {
        fraction = 0;
        dir = 1;
      }
      if (joint === "cap") setCap(fraction);
      else setRefill(fraction);
      id = requestAnimationFrame(frame);
    }
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
    // The playback clock takes a new initial pose when the active joint changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, joint, problem]);
  useEffect(() => {
    if (!recording) return;
    recordingRef.current.push({
      time: (performance.now() - startTime.current) / 1000,
      angle,
      cap: capX,
      refill: refillX,
    });
  }, [recording, angle, capX, refillX]);
  function recordMotion() {
    if (recording) {
      record(false);
      setRecordCount(recordingRef.current.length);
    } else {
      recordingRef.current = [];
      startTime.current = performance.now();
      record(true);
      setRecordCount(0);
    }
  }
  function exportMotion() {
    const rows = recordingRef.current.map((p) =>
      [p.time, p.angle, p.cap, p.refill].map((x) => n(x, 6)).join(","),
    );
    saveAs(
      [
        "time_s,cap_angle_deg,cap_displacement_mm,refill_displacement_mm",
        ...rows,
      ].join("\n"),
      "text/csv",
      fileName(props.project.name) + "-motion.csv",
    );
  }
  const fullTravel = Math.max(0, turns * Math.abs(lead)),
    xShift = exploded ? len * 0.16 : 0;
  const maxR = Math.max(outer, capID / 2 + 1.1, 1);
  const s = Math.min(
      606 / (len + sleeve + fullTravel + len * 0.22),
      110 / maxR,
    ),
    origin = 78,
    cy = 152;
  const x = (at: number) => origin + (at - minX) * s,
    y = (at: number) => cy - at * s;
  const poly = (pts: XY[]) =>
    pts.map(([px, py]) => `${x(px)},${y(py)}`).join(" ");
  const at = seat + capX + xShift,
    ri = capID / 2,
    ro = Math.max(ri + 1.1, outer * 0.85),
    back = at + sleeve;
  const capPoly: XY[] = [
    [at, ri],
    [at, ro - 0.35],
    [at + 0.35, ro],
    [back - 0.6, ro],
    [back, ro - 0.6],
    [back, ri],
  ];
  const refillR = Math.max(
    0.18,
    Math.min(
      Math.min(...source.map((p) => Math.abs(p[1]))) * 0.77,
      outer * 0.38,
    ),
  );
  const ax = minX + len * 0.015 - refillX - (exploded ? len * 0.1 : 0),
    ex = maxX - len * 0.04 - refillX - (exploded ? len * 0.1 : 0);
  const colored = (pts: XY[], color: string) => (
    <polygon points={poly(pts)} fill={color} stroke={color} strokeWidth=".7" />
  );
  const metric = (s: string, v: string) => (
    <div className="tm-metric">
      <span>{s}</span>
      <strong>{v}</strong>
    </div>
  );
  return (
    <div className="tm-workspace">
      <main className="tm-work-main">
        <header className="tm-work-head">
          <div>
            <h2>Assembly</h2>
            <p>{sourceName} · coaxial pen study</p>
          </div>
          <button
            className={"tm-btn " + (exploded ? "selected" : "")}
            onClick={() => explode(!exploded)}
          >
            <Boxes size={15} />
            {exploded ? "Assemble" : "Explode"}
          </button>
        </header>
        <section className="tm-motion-stage">
          <div className="tm-stage-caption">
            <span className="tm-dot" />
            Longitudinal section{exploded ? " · exploded" : ""}
          </div>
          {problem ? (
            <div className="tm-inline-error" role="alert">
              {problem}
            </div>
          ) : (
            <svg
              ref={stage}
              className="tm-motion-svg"
              viewBox="0 0 760 300"
              role="img"
              aria-label="Draggable pen assembly section"
              onPointerDown={(e) => {
                play(false);
                drag.current = { x: e.clientX, f: animated, id: e.pointerId };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (drag.current?.id === e.pointerId)
                  pose(
                    drag.current.f +
                      (e.clientX - drag.current.x) /
                        Math.max(
                          100,
                          (stage.current?.clientWidth || 400) * 0.5,
                        ),
                  );
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <defs>
                <linearGradient id="tm-barrel" x2="0" y2="1">
                  <stop stopColor="#d9a963" />
                  <stop offset="1" stopColor="#906c40" />
                </linearGradient>
                <pattern
                  id="tm-hatch"
                  width="7"
                  height="7"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(35)"
                >
                  <path d="M 0 0 V 7" stroke="#191b1b" strokeWidth="1.4" />
                </pattern>
              </defs>
              <line
                x1="26"
                x2="733"
                y1={cy}
                y2={cy}
                stroke="#657274"
                strokeDasharray="8 4 2 4"
              />
              {colored(
                [
                  [ax - 2, 0],
                  [ax, refillR],
                  [ex, refillR],
                  [ex, -refillR],
                  [ax, -refillR],
                ],
                "#6f9ba6",
              )}
              {[1, -1].map((sign) => (
                <g key={sign}>
                  <polygon
                    points={poly(
                      source.map(([xx, rr]) => [xx, sign * Math.abs(rr)]),
                    )}
                    fill="url(#tm-barrel)"
                    stroke="#e3b570"
                    strokeWidth="1"
                  />
                  <polygon
                    points={poly(
                      source.map(([xx, rr]) => [xx, sign * Math.abs(rr)]),
                    )}
                    fill="url(#tm-hatch)"
                  />
                </g>
              ))}
              {[1, -1].map((sign) => (
                <g key={sign}>
                  {colored(
                    capPoly.map(([xx, rr]) => [xx, rr * sign]),
                    "#bdc7ca",
                  )}
                </g>
              ))}
              <path
                d={`M ${x(back - 1)} ${y(ro)} Q ${x(back - 1)} ${y(ro + 1.5)} ${x(back - 3)} ${y(ro + 1.5)} L ${x(at - 5)} ${y(ro + 1.5)} Q ${x(at - 6)} ${y(ro + 1.5)} ${x(at - 7)} ${y(ro + 0.7)}`}
                fill="none"
                stroke="#a6afa9"
                strokeWidth={Math.max(1.6, s * 0.42)}
              />
              <text x="33" y="275" className="tm-svg-legend">
                X
              </text>
              <path
                d="M 50 271 h 28 l -4 -3 m 4 3 l -4 3"
                fill="none"
                stroke="#677673"
              />
            </svg>
          )}
          <div className="tm-legend">
            {["Barrel", "Cap", "Refill", "Clip"].map((name, i) => (
              <span key={name}>
                <i
                  style={{
                    background: ["#d7a45f", "#bdc7ca", "#6f9ba6", "#869088"][i],
                  }}
                />
                {name}
              </span>
            ))}
          </div>
        </section>
        <div className="tm-motion-controls">
          <div className="tm-control-heading">
            <h3>Motion</h3>
            <div className="tm-segment">
              {(["cap", "refill"] as const).map((j) => (
                <button
                  key={j}
                  aria-pressed={j === joint}
                  onClick={() => {
                    setJoint(j);
                    play(false);
                  }}
                >
                  {j === "cap" ? "Cap screw" : "Refill slider"}
                </button>
              ))}
            </div>
          </div>
          <div className="tm-slider-row">
            <button
              className="tm-icon"
              disabled={!!problem}
              title={playing ? "Pause" : "Play motion"}
              aria-label={playing ? "Pause" : "Play motion"}
              onClick={() => play(!playing)}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <input
              aria-label="Joint position"
              type="range"
              min="0"
              max="1"
              step=".001"
              value={animated}
              disabled={!!problem}
              onChange={(e) => {
                play(false);
                pose(+e.target.value);
              }}
            />
            <output>
              {joint === "cap" ? n(angle, 1) + "°" : n(refillX) + " mm"}
            </output>
            <button
              className="tm-icon"
              title="Reset pose"
              aria-label="Reset pose"
              onClick={() => {
                play(false);
                setCap(0);
                setRefill(0);
              }}
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="tm-action-row">
            <button
              className="tm-text-btn"
              disabled={!!problem}
              onClick={recordMotion}
            >
              <Disc3 size={14} />
              {recording ? "Stop recording" : "Record positions"}
            </button>
            {!recording && recordCount > 0 && (
              <button className="tm-text-btn" onClick={exportMotion}>
                <Download size={14} />
                Motion CSV
              </button>
            )}
            <span className="tm-spacer" />
            <span className="tm-subtle">
              {joint === "cap"
                ? "Axial travel " + n(capX) + " mm"
                : "Stops at 0 and " + n(stroke) + " mm"}
            </span>
          </div>
        </div>
        <AssemblyBom project={props.project} features={props.features} />
      </main>
      <aside className="tm-inspector">
        <h3>Joint settings</h3>
        {joint === "cap" ? (
          <>
            <NumberField
              title="Thread pitch"
              expr={pitchExpr}
              values={values}
              onCommit={(pitch) => patch({ pitch })}
              valid={(d) => d > 0}
              unit="mm"
            />
            <div className="tm-pair">
              <NumberField
                title="Starts"
                expr={startExpr}
                values={values}
                kind="scalar"
                valid={(d) => Number.isInteger(d) && d > 0}
                onCommit={(starts) => patch({ starts })}
              />
              <NumberField
                title="Travel limit"
                expr={turnExpr}
                values={values}
                kind="scalar"
                valid={(d) => d > 0}
                onCommit={(turns) => patch({ turns })}
                unit="turn"
              />
            </div>
            <label className="tm-field">
              <span>Handedness</span>
              <select
                value={cfg.hand || "right"}
                onChange={(e) => patch({ hand: e.target.value })}
              >
                <option value="right">Right hand</option>
                <option value="left">Left hand</option>
              </select>
            </label>
            {metric("Signed lead", n(lead) + " mm / rev")}
          </>
        ) : (
          <NumberField
            title="Travel limit"
            expr={slideExpr}
            values={values}
            onCommit={(stroke) => patch({ stroke })}
            valid={(d) => d >= 0}
            unit="mm"
          />
        )}
        <h3>Cap clearance</h3>
        <NumberField
          title="Pilot engagement"
          expr={shoulderExpr}
          values={values}
          onCommit={(seat) => patch({ seat })}
          valid={(d) => d > 0 && d < len}
          unit="mm"
        />
        <label className="tm-field">
          <span>Fit model</span>
          <select
            value={cfg.fit || "custom"}
            onChange={(e) => patch({ fit: e.target.value })}
          >
            <option value="custom">Custom diameter limits</option>
            <option value="iso">ISO 286 limits</option>
          </select>
        </label>
        {cfg.fit === "iso" && (
          <label className="tm-field">
            <span>ISO fit class</span>
            <select
              aria-label="ISO fit class"
              value={fitCode}
              onChange={(e) => patch({ fitClass: e.target.value })}
            >
              {fitClasses.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        {!fit && cfg.fit !== "iso" && (
          <>
            <NumberField
              title="Cap bore diameter"
              expr={String(cfg.capId ?? n(defaultDiameter + 0.1, 8))}
              values={values}
              onCommit={(capId) => patch({ capId })}
              valid={(d) => d > 0}
              unit="mm"
            />
            <details className="tm-more">
              <summary>Diameter tolerances (±)</summary>
              <NumberField
                title="Barrel tolerance"
                expr={shaftTolExpr}
                values={values}
                onCommit={(shaftTol) => patch({ shaftTol })}
                valid={(d) => d >= 0}
                unit="mm"
              />
              <NumberField
                title="Bore tolerance"
                expr={boreTolExpr}
                values={values}
                onCommit={(boreTol) => patch({ boreTol })}
                valid={(d) => d >= 0}
                unit="mm"
              />
            </details>
          </>
        )}
        {dataOK ? (
          <div className={"tm-result " + (worstMin < 0 ? "tm-warn" : "")}>
            <b>
              {fit
                ? fit.kind
                : worstMin < 0
                  ? "Possible interference"
                  : worstMin === 0
                    ? "Zero minimum clearance"
                    : "Pilot clears through travel"}
            </b>
            {metric("Nominal diametral gap", n(nominal, 4) + " mm")}
            {metric(
              "Limit clearances",
              n(worstMin, 4) + " … " + n(worstMax, 4) + " mm",
            )}
            {fit && (
              <>
                {metric(
                  "H7 bore",
                  n(fit.holeMin, 4) + " … " + n(fit.holeMax, 4),
                )}
                {metric(
                  fitCode.slice(3) + " pilot",
                  n(fit.shaftMin, 4) + " … " + n(fit.shaftMax, 4),
                )}
              </>
            )}
          </div>
        ) : (
          <p className="tm-inline-error">
            {props.hasBodyEdits
              ? "Clearance requires a straight-sided meridian and a body without later operations. Check the final solid independently."
              : problem}
          </p>
        )}
        <p className="tm-help">
          The section uses a reference cap and refill. To name actual bore and
          shaft surfaces, open Mating fits in 3D assembly. The fit check covers
          the coaxial pilot and sleeve over their complete axial sweep,
          beginning 0.02 mm past the shoulder or less. Threads, shoulder
          contact, and clip are outside this check.
        </p>
      </aside>
    </div>
  );
}
