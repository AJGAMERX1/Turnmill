import { BookOpen, Pause } from "lucide-react";
import { guideMode, guideSteps, type PenGuide } from "./penGuide";
import { evaluate, resolveParameters } from "./expressions";
import type { Project } from "./types";
import "./penGuide.css";

const titles = {
  barrel: "Revolve the barrel",
  cap: "Thread the cap",
  internals: "Fit the refill and clip",
  motion: "Turn the cap",
  clearance: "Check cap clearance",
  drawing: "Make the barrel drawing",
  finished: "Walkthrough complete",
};
export function GuideProfile({ project }: { project: Project }) {
  const source = project.sketches.find((s) => s.id === "barrel-profile");
  if (!source || source.points.length < 3) return null;
  try {
    const vals = resolveParameters(project.parameters);
    const points = source.points.map((p) => [
      evaluate(p.x, vals),
      evaluate(p.y, vals),
    ]);
    const x0 = Math.min(...points.map((p) => p[0])),
      x1 = Math.max(...points.map((p) => p[0]));
    const radius = Math.max(...points.map((p) => Math.abs(p[1]))),
      scale = Math.min(340 / (x1 - x0 || 1), 70 / (radius || 1));
    const x = (v: number) => 200 + (v - (x0 + x1) / 2) * scale;
    const y = (v: number) => 80 - v * scale;
    return (
      <div className="pen-guide-profile">
        <svg
          viewBox="0 0 400 115"
          role="img"
          aria-label="Barrel half-profile above the X turning axis"
        >
          <path
            d="M10 80H384l-5 -3m5 3 -5 3"
            stroke="#96a7a6"
            fill="none"
            strokeDasharray="5 3"
          />
          <polygon
            points={points.map((p) => x(p[0]) + "," + y(p[1])).join(" ")}
            fill="#5a4931"
            stroke="#edbd75"
            strokeWidth="1.5"
          />
          <text x="375" y="98" fill="#b9c3bf">
            X
          </text>
        </svg>
        <p>Barrel profile · {Number((x1 - x0).toFixed(3))} mm</p>
      </div>
    );
  } catch {
    return null;
  }
}

export default function PenGuidePanel({
  guide,
  mode,
  busy,
  error,
  drawingReady,
  act,
  pause,
}: {
  guide: PenGuide;
  mode: string;
  busy: boolean;
  error: string;
  drawingReady: boolean;
  act: () => void;
  pause: () => void;
}) {
  const stage = guide.stage;
  const target = guideMode(stage);
  const notes = {
    barrel:
      "Set Barrel length in the Inspector, then revolve the closed profile 360° about X.",
    cap: "Set Thread pitch in the Inspector. Both threads will use that parameter.",
    internals:
      "Turning the cap drives a cam that slides the refill through the barrel. The clip turns with the cap.",
    motion:
      "Choose Twist cap to extend the tip by a half-turn. Twist again to retract it. Save current pose with the tip extended to continue.",
    clearance:
      (guide.refillTravel !== undefined
        ? "The refill moved " + Number(Math.abs(guide.refillTravel).toFixed(3)) + " mm. "
        : guide.travel === undefined
        ? ""
        : "Saved travel " + Number(guide.travel.toFixed(4)) + " mm. ") +
      "Run Full travel for the threaded cap against the barrel.",
    drawing:
      (guide.lowerBound === undefined
        ? ""
        : "Clearance throughout travel ≥ " +
          (Math.floor(guide.lowerBound * 100000) / 100000).toFixed(5) +
          " mm. ") + "Download or print the dimensioned barrel sheets.",
    finished:
      "Your four-part pen and its linked drawing are saved with the project.",
  };
  const actions = {
    barrel: "Revolve barrel",
    cap: "Add threaded cap",
    internals: "Add refill and clip",
    motion: "Twist cap",
    clearance: "Find clearance check",
    drawing: drawingReady ? "Find PDF export" : "Open barrel drawing",
    finished: "Finish",
  };
  const targetLabel =
    mode !== target && stage !== "finished"
      ? "Open " +
        (target === "Drawing" ? "barrel drawing" : target.toLowerCase())
      : actions[stage];
  const building =
    mode === target && ["cap", "internals"].includes(stage) && busy;
  return (
    <section className="pen-guide-panel" aria-label="Guided pen walkthrough">
      <BookOpen size={19} aria-hidden="true" />
      <div className="pen-guide-copy">
        <small>
          {stage === "finished"
            ? "Guided pen"
            : "Guided pen · " + (guideSteps.indexOf(stage) + 1) + " of 6"}
        </small>
        <strong>{titles[stage]}</strong>
        <p>{notes[stage]}</p>
      </div>
      <button
        className="primary"
        onClick={act}
        disabled={
          building || (!!error && mode === "Part" && stage !== "barrel")
        }
      >
        {building ? "Building parts…" : targetLabel}
      </button>
      {stage !== "finished" && (
        <button
          className="icon"
          aria-label="Pause walkthrough"
          title="Pause walkthrough"
          onClick={pause}
        >
          <Pause size={15} />
        </button>
      )}
    </section>
  );
}
