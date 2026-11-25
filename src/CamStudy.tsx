import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, Pause, Play, RotateCcw } from "lucide-react";
import {
  changeWorkspace,
  fileName,
  saveAs,
  type WorkspaceProps,
} from "./secondaryVector";
import "./camStudy.css";
import CamCoupling from "./CamCoupling";
import type { ThreadFrame } from "./threadMates";

import {
  camPhase,
  camFields as fields,
  camValueOf as valueOf,
  camDefaults as defaults,
  evaluateCam,
  camSample,
  type CamExpressions as Expressions,
  type CamInputs,
  type CamSample,
  type CamSpec as Spec,
} from "./camLaw";
export {
  evaluateCam,
  camSample,
  type CamInputs,
  type CamSample,
} from "./camLaw";
const radians = Math.PI / 180;
const fmt = (v: number, digits = 2) => String(Number(v.toFixed(digits)));
function studyRows(c: CamInputs) {
  // Include all phase boundaries and midpoints, even for sub-degree cam events.
  const grid = new Set<number>(Array.from({ length: 361 }, (_, i) => i)),
    pitch = 360 / c.lobes;
  for (let i = 0; i < c.lobes; i++)
    for (const a of [
      0,
      c.rise / 2,
      c.rise,
      c.rise + c.high,
      c.rise + c.high + c.returnAngle / 2,
      c.rise + c.high + c.returnAngle,
    ]) {
      grid.add(Number((i * pitch + a).toFixed(10)));
    }
  return [...grid].sort((a, b) => a - b).map((angle) => camSample(c, angle));
}
function CamField({
  spec,
  value,
  values,
  commit,
}: {
  spec: Spec;
  value: string;
  values: Record<string, number>;
  commit: (s: string) => void;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(value);
    setError("");
  }, [value]);
  const finish = () => {
    if (draft === value) return;
    try {
      valueOf(draft, spec.kind, values);
      setError("");
      commit(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the expression.");
    }
  };
  return (
    <label className="tm-field">
      <span>{spec.title}</span>
      <span className="tm-number">
        <input
          aria-label={spec.title}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value);
              setError("");
            }
          }}
        />
        {spec.unit && <small>{spec.unit}</small>}
      </span>
      {error && <em role="alert">{error}</em>}
    </label>
  );
}

function CamSection({
  c,
  current,
  scrub,
}: {
  c: CamInputs;
  current: CamSample;
  scrub: (v: number) => void;
}) {
  const uid = useId().replace(/:/g, ""),
    drag = useRef<{ x: number; theta: number; scale: number } | null>(null);
  const width = 740,
    cx = 360,
    base = 204,
    pitchLength = (2 * Math.PI * c.radius) / c.lobes;
  const scale = Math.min(250 / pitchLength, 66 / c.lift),
    oneDegree = scale * c.radius * radians;
  const track = Array.from({ length: 401 }, (_, i) => {
    const x = (width * i) / 400,
      angle = current.theta + (x - cx) / oneDegree;
    return [x, base - camPhase(c, angle).h * scale];
  });
  const trackLine = track
    .map(([x, y], i) => (i ? "L" : "M") + fmt(x, 3) + " " + fmt(y, 3))
    .join(" ");
  const contactY = base - current.lift * scale,
    followerTop = contactY - 31,
    springTop = 24,
    gap = followerTop - springTop;
  const hasContact = current.normal !== null;
  const spring = [
    [cx, springTop],
    [cx, springTop + 3],
    ...Array.from({ length: 17 }, (_, i) => [
      cx + (i % 2 ? -11 : 11),
      springTop + 5 + ((gap - 10) * i) / 16,
    ]),
    [cx, followerTop - 1],
    [cx, followerTop],
  ];
  return (
    <svg
      className="cam-section"
      viewBox="0 0 740 247"
      role="slider"
      aria-label="Scrub cam section"
      tabIndex={0}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={+fmt(current.theta, 1)}
      aria-valuetext={fmt(current.theta) + " degrees, " + current.event}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          scrub(
            Math.max(
              0,
              Math.min(
                360,
                current.theta +
                  (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1),
              ),
            ),
          );
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const b = e.currentTarget.getBoundingClientRect();
        drag.current = {
          x: e.clientX,
          theta: current.theta,
          scale: (b.width / width) * oneDegree,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          const d = drag.current;
          scrub(
            Math.max(0, Math.min(360, d.theta + (d.x - e.clientX) / d.scale)),
          );
        }
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <defs>
        <pattern
          id={"camgrid" + uid}
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <path d="M24 0H0V24" fill="none" stroke="#2b3737" strokeWidth=".7" />
        </pattern>
        <pattern
          id={"camhatch" + uid}
          width="9"
          height="9"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M-3 3L3 -3M0 9L9 0M6 12L12 6"
            stroke="#8b71494d"
            strokeWidth=".8"
          />
        </pattern>
      </defs>
      <rect width="740" height="247" fill="#172022" />
      <rect width="740" height="247" fill={"url(#camgrid" + uid + ")"} />
      <path d={trackLine + " L740 247 H0 Z"} fill="#4a4030" />
      <path
        d={trackLine + " L740 247 H0 Z"}
        fill={"url(#camhatch" + uid + ")"}
      />
      <path d={trackLine} fill="none" stroke="#e8b56e" strokeWidth="2.2" />
      <path
        d={"M" + cx + " 8V229"}
        stroke="#c5c6ae"
        strokeDasharray="4 6"
        opacity=".45"
      />
      <path
        d={"M" + (cx - 25) + " 23H" + (cx + 25)}
        stroke="#b0bdb8"
        strokeWidth="3"
      />
      <polyline
        points={spring.map((p) => p.join(",")).join(" ")}
        stroke="#a8c5bd"
        fill="none"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d={"M" + (cx - 9) + " " + followerTop + " h18 v18 l-9 13 -9 -13 Z"}
        fill={hasContact ? "#9bb8ae" : "#9bb8ae33"}
        stroke={hasContact ? "#cae3d8" : "#e9a98b"}
        strokeDasharray={hasContact ? undefined : "4 3"}
        strokeWidth="1.3"
      />
      <path
        d={"M" + (cx - 14) + " " + (followerTop - 2) + "v19 m28 -19v19"}
        stroke="#637c75"
        strokeWidth="3"
      />
      <circle cx={cx} cy={contactY} r="3" fill="#f7d199" />
      <path
        d={"M" + (cx + 17) + " " + (followerTop + 7) + " h22"}
        stroke="#77978f"
      />
      <text x={cx + 43} y={followerTop + 11}>
        {hasContact ? "Follower" : "Demanded follower position"}
      </text>
      <path
        d={"M" + (cx + 17) + " " + (springTop + 17) + "h22"}
        stroke="#77978f"
      />
      <text x={cx + 43} y={springTop + 21}>
        Spring
      </text>
      <text x="15" y="229" fill="#dec095">
        Cam face
      </text>
      <text x="728" y="23" textAnchor="end">
        Unwrapped pitch cylinder
      </text>
    </svg>
  );
}
type ChartKey = "lift" | "spring" | "torque" | "pressure";
const series: Record<ChartKey, { label: string; unit: string }> = {
  lift: { label: "Lift", unit: "mm" },
  spring: { label: "Spring force", unit: "N" },
  torque: { label: "Drive torque", unit: "N·mm" },
  pressure: { label: "Pressure angle", unit: "°" },
};
function Chart({
  c,
  theta,
  which,
  scrub,
}: {
  c: CamInputs;
  theta: number;
  which: ChartKey;
  scrub: (v: number) => void;
}) {
  const pitch = 360 / c.lobes,
    base = Math.min(c.lobes - 1, Math.floor(theta / pitch)) * pitch;
  const points = useMemo(() => {
    const knots = [
      0,
      c.rise,
      c.rise + c.high,
      c.rise + c.high + c.returnAngle,
      pitch,
    ];
    return knots
      .slice(1)
      .flatMap((end, i) =>
        Array.from({ length: 65 }, (_, j) =>
          camSample(c, knots[i] + ((end - knots[i]) * j) / 64),
        ),
      );
  }, [c, pitch]);
  const values = points
    .map((s) => s[which])
    .filter((v) => v !== null) as number[];
  const limit =
    which === "lift" ? c.travel : which === "pressure" ? c.pressure : null;
  const low = Math.min(0, ...values),
    high = Math.max(1e-7, ...values, ...(limit === null ? [] : [limit])),
    x0 = 47,
    span = 633;
  const x = (a: number) => x0 + (span * a) / pitch,
    y = (v: number) => 103 - (78 * (v - low)) / (high - low);
  let active = false;
  const line = points
    .map((s) => {
      const v = s[which];
      if (v === null) {
        active = false;
        return "";
      }
      const cmd = active ? "L" : "M";
      active = true;
      return cmd + fmt(x(s.theta), 3) + " " + fmt(y(v), 3);
    })
    .join(" ");
  return (
    <svg
      className="cam-chart"
      viewBox="0 0 700 133"
      role="img"
      aria-label={series[which].label + " through one cam lobe"}
      onPointerDown={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        const local = ((e.clientX - b.left) / b.width) * 700;
        scrub(base + Math.max(0, Math.min(1, (local - x0) / span)) * pitch);
      }}
    >
      <rect
        x={x(c.rise)}
        y="16"
        width={(span * c.high) / pitch}
        height="87"
        fill="#303a37"
      />
      {[low, (low + high) / 2, high].map((v, i) => (
        <g key={i}>
          <line
            x1={x0}
            x2={x0 + span}
            y1={y(v)}
            y2={y(v)}
            stroke="#3c4945"
            strokeWidth=".8"
          />
          <text x={x0 - 6} y={y(v) + 3} textAnchor="end">
            {fmt(v)}
          </text>
        </g>
      ))}
      {[0, pitch / 2, pitch].map((a, i) => (
        <text
          x={x(a)}
          y="122"
          textAnchor={i === 2 ? "end" : i === 0 ? "start" : "middle"}
          key={a}
        >
          {fmt(a)}°
        </text>
      ))}
      {limit !== null && (
        <line
          x1={x0}
          x2={x0 + span}
          y1={y(limit)}
          y2={y(limit)}
          stroke="#b6976a"
          strokeDasharray="4 5"
        >
          <title>
            Set limit {fmt(limit)} {series[which].unit}
          </title>
        </line>
      )}
      <path d={line} fill="none" stroke="#efbc77" strokeWidth="2" />
      <line
        x1={x(theta - base)}
        x2={x(theta - base)}
        y1="12"
        y2="103"
        stroke="#82bda7"
        strokeDasharray="4 3"
      />
    </svg>
  );
}

export default function CamStudy(
  props: WorkspaceProps & {
    onOpenAssembly?: () => void;
    threadFrames?: ThreadFrame[];
  },
) {
  const { project, values } = props,
    saved = project.workspaces?.camStudy || {};
  const expressions = useMemo(
    () => ({ ...defaults(values), ...saved }) as Expressions,
    [values, project.workspaces?.camStudy],
  );
  const run = useMemo(() => {
    try {
      return { c: evaluateCam(expressions, values), error: "" };
    } catch (e) {
      return { c: null, error: (e as Error).message };
    }
  }, [expressions, values]);
  const c = run.c;
  const [theta, setTheta] = useState(0),
    [playing, setPlaying] = useState(false),
    [which, setWhich] = useState<ChartKey>("lift");
  const current = c ? camSample(c, theta) : null,
    pitch = c ? 360 / c.lobes : 0;
  useEffect(() => {
    if (!playing || !c) return;
    let last: number | null = null,
      id = 0;
    const tick = (now: number) => {
      if (last !== null) {
        const delta = (Math.min(now - last, 100) * pitch) / 3600;
        setTheta((t) => (t + delta) % 360);
      }
      last = now;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, c, pitch]);
  useEffect(() => {
    if (!c) setPlaying(false);
  }, [c]);
  function scrub(v: number) {
    setPlaying(false);
    setTheta(v);
  }
  function exportData() {
    if (!c) return;
    const head = [
      "angle_deg",
      "lobe",
      "event",
      "demand_lift_mm",
      "slope_mm_per_rad",
      "spring_compression_mm",
      "spring_force_demand_N",
      "axial_closing_demand_N",
      "pressure_angle_deg",
      "normal_force_in_contact_N",
      "drive_torque_in_contact_N_mm",
      "path_status",
      "pressure_limit_status",
    ];
    const data = studyRows(c).map((s) =>
      [
        s.theta,
        Math.min(c.lobes, 1 + Math.floor(s.theta / pitch)),
        s.event,
        s.lift,
        s.slope,
        s.compression,
        s.spring,
        s.closing,
        s.pressure,
        s.normal,
        s.torque,
        s.state,
        s.pressure > c.pressure ? "above limit" : "within limit",
      ]
        .map((v) => (typeof v === "number" ? fmt(v, 7) : (v ?? "")))
        .join(","),
    );
    saveAs(
      [head.join(","), ...data].join("\r\n"),
      "text/csv;charset=utf-8",
      fileName(project.name) + "-cam-cycle.csv",
    );
  }
  const formFields = (start: number, end: number) =>
    fields
      .slice(start, end)
      .map((f) => (
        <CamField
          key={f.key}
          spec={f}
          value={expressions[f.key]}
          values={values}
          commit={(value) =>
            changeWorkspace(props, "camStudy", { [f.key]: value })
          }
        />
      ));
  const maxAngle = c
    ? Math.atan(
        (c.lift * Math.PI) /
          (2 * Math.min(c.rise, c.returnAngle) * radians * c.radius),
      ) / radians
    : 0;
  const constraints = c
    ? [
        {
          name: "Follower travel",
          actual: c.lift,
          limit: c.travel,
          unit: "mm",
        },
        {
          name: "Spring compression",
          actual: c.preload / c.rate + c.lift,
          limit: c.compression,
          unit: "mm",
        },
        {
          name: "Pressure angle",
          actual: maxAngle,
          limit: c.pressure,
          unit: "°",
        },
      ]
    : [];
  return (
    <div className="tm-workspace cam-work">
      <div className="tm-work-main">
        <div className="cam-head">
          <div>
            <h2>Click cam study</h2>
            <p>Spring-loaded axial follower · harmonic rise and return</p>
          </div>
          <button className="cam-export" disabled={!c} onClick={exportData}>
            <Download size={14} /> Export CSV
          </button>
        </div>
        {run.error && (
          <p className="tm-inline-error" role="alert">
            {run.error}
          </p>
        )}
        {c && current && (
          <>
            <div className="cam-stage">
              <CamSection c={c} current={current} scrub={scrub} />
              <div className="cam-controls">
                <button
                  aria-label={playing ? "Pause cycle" : "Play cycle"}
                  title={playing ? "Pause cycle" : "Play cycle"}
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button
                  aria-label="Reset cam angle"
                  title="Reset cam angle"
                  onClick={() => scrub(0)}
                >
                  <RotateCcw size={14} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step=".1"
                  value={theta}
                  aria-label="Cam rotation"
                  onChange={(e) => scrub(Number(e.target.value))}
                />
                <output>{fmt(theta, 1)}°</output>
              </div>
            </div>
            <div className="cam-stage-caption">
              <span>
                {current.event} · lobe{" "}
                {Math.min(c.lobes, Math.floor(theta / pitch) + 1)} of {c.lobes}
              </span>
              <span>
                {current.state === "Contact"
                  ? "Prescribed motion"
                  : current.state}
              </span>
            </div>
            <div className="cam-results">
              {[
                ["Nominal lift", fmt(current.lift, 3), "mm"],
                ["Spring force demand", fmt(current.spring, 3), "N"],
                [
                  "Drive torque",
                  current.torque === null ? "—" : fmt(current.torque, 3),
                  "N·mm",
                ],
                ["Pressure angle", fmt(current.pressure), "°"],
              ].map(([title, v, u]) => (
                <div key={title}>
                  <span>{title}</span>
                  <strong>
                    {v}
                    <small>{u}</small>
                  </strong>
                </div>
              ))}
            </div>
            <section className="cam-curve">
              <header>
                <h3>Lobe response</h3>
                <select
                  aria-label="Response to plot"
                  value={which}
                  onChange={(e) => setWhich(e.target.value as ChartKey)}
                >
                  {Object.entries(series).map(([k, s]) => (
                    <option key={k} value={k}>
                      {s.label} ({s.unit})
                    </option>
                  ))}
                </select>
              </header>
              <Chart c={c} theta={theta} which={which} scrub={scrub} />
            </section>
            <section className="cam-limits">
              <h3>Full-cycle limits</h3>
              {constraints.map((row) => (
                <div key={row.name}>
                  <span>{row.name}</span>
                  <code>
                    {fmt(row.actual, 3)} / {fmt(row.limit, 3)} {row.unit}
                  </code>
                  <b className={row.actual > row.limit + 1e-8 ? "out" : "in"}>
                    {row.actual > row.limit + 1e-8 ? "Exceeded" : "Within"}
                  </b>
                </div>
              ))}
              <div>
                <span>Minimum closing force</span>
                <code>{fmt(c.preload + c.load, 3)} N</code>
                <b className={c.preload + c.load > 1e-10 ? "in" : "out"}>
                  {c.preload + c.load > 1e-10 ? "Positive" : "No margin"}
                </b>
              </div>
            </section>
          </>
        )}
        <details className="cam-method">
          <summary>Study assumptions and units</summary>
          <p>
            This quasistatic model prescribes a point follower on a rotating
            face cam at a constant pitch radius. It assumes rigid geometry, a
            linear spring, and frictionless contact. Additional positive axial
            load opposes lift. Animation speed is for viewing.
          </p>
          <p>
            Spring force equals preload plus stiffness times lift. Drive torque
            equals axial closing force times lift slope per radian. The pressure
            angle follows the slope on the unwrapped cylinder. Blank force or
            torque values mark an infeasible prescribed position or missing
            contact. Dynamics, impact, wear, latch engagement, and manufacturing
            clearances require separate analysis.{" "}
            <a
              href="https://www.cs.cmu.edu/~rapidproto/mechanisms/chpt6.html"
              target="_blank"
              rel="noreferrer"
            >
              CMU cam terminology
            </a>
          </p>
        </details>
      </div>
      <aside className="tm-inspector cam-inspector">
        <CamCoupling {...props} law={expressions} />
        <h3>Cam geometry</h3>
        {formFields(0, 6)}
        {c && (
          <p className="cam-note">
            Lobe pitch {fmt(pitch)}° · low dwell{" "}
            {fmt(Math.max(0, pitch - c.rise - c.high - c.returnAngle))}°
          </p>
        )}
        <h3>Spring and load</h3>
        {formFields(6, 9)}
        <p className="cam-note">
          Positive load opposes lift. Force fields accept N or lbf, stiffness
          accepts N/mm or lbf/in.
        </p>
        <h3>Design limits</h3>
        {formFields(9, 12)}
        <p className="cam-note">
          Dimensions accept formulas and named project parameters.
        </p>
      </aside>
    </div>
  );
}
