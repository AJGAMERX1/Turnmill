import { evaluate, resolveParameters } from "./expressions";
import { turnedProject, twistPenProject } from "./projects";
import type { ClearanceResult } from "./clearance";
import type { Feature, Project } from "./types";

export const guideSteps = [
  "barrel",
  "cap",
  "internals",
  "motion",
  "clearance",
  "drawing",
  "finished",
] as const;
type Stage = (typeof guideSteps)[number];
export type PenGuide = {
  version: 1;
  stage: Stage;
  paused: boolean;
  barrelId: string;
  rotation?: number;
  travel?: number;
  lowerBound?: number;
};

export function penGuide(project: Project): PenGuide | undefined {
  const state = project.workspaces?.penGuide;
  return state?.version === 1 &&
    guideSteps.includes(state.stage) &&
    typeof state.barrelId === "string" &&
    typeof state.paused === "boolean" &&
    [state.rotation, state.travel, state.lowerBound].every(
      (value) => value === undefined || Number.isFinite(value),
    )
    ? state
    : undefined;
}

export function guideMode(stage: Stage) {
  if (stage === "motion" || stage === "clearance") return "Assembly";
  if (stage === "drawing" || stage === "finished") return "Drawing";
  return "Part";
}

export function setGuide(project: Project, change: Partial<PenGuide>): Project {
  const guide = penGuide(project);
  if (!guide) return project;
  return {
    ...project,
    workspaces: { ...project.workspaces, penGuide: { ...guide, ...change } },
  };
}

export function guidedPen(): Project {
  const p = turnedProject();
  return {
    ...p,
    name: "My twist pen",
    features: [],
    workspaces: {
      penGuide: {
        version: 1,
        stage: "barrel",
        paused: false,
        barrelId: "",
      } satisfies PenGuide,
    },
  };
}

/** Also recognize a revolve created from the normal Part toolbar or by editing an existing feature. */
export function guideFeatureSaved(p: Project, f: Feature) {
  const guide = penGuide(p);
  if (
    !guide ||
    guide.paused ||
    guide.stage !== "barrel" ||
    f.kind !== "revolve" ||
    f.operation !== "new" ||
    f.suppressed ||
    f.sketchId !== "barrel-profile"
  )
    return p;
  const angle = evaluate(f.amount, resolveParameters(p.parameters), "angle");
  return Math.abs(Math.abs(angle) - 360) <= 1e-9
    ? setGuide(p, { stage: "cap", barrelId: f.id })
    : p;
}

export function addGuideParts(project: Project): Project {
  const guide = penGuide(project);
  if (!guide || guide.paused || !["cap", "internals"].includes(guide.stage))
    return project;
  const barrel = project.features.find((f) => f.id === guide.barrelId);
  if (!barrel || barrel.suppressed)
    throw Error(
      "Restore the guided barrel in feature history before adding parts.",
    );
  const capStep = guide.stage === "cap";
  const template = twistPenProject();
  const ids = capStep ? ["pen-cap"] : ["pen-refill", "pen-clip"];
  const parts = template.features.filter((f) => ids.includes(f.id));
  const sketches = template.sketches.filter((s) =>
    parts.some((f) => f.sketchId === s.id),
  );
  if (
    project.features.some((f) => ids.includes(f.id)) ||
    sketches.some((s) => project.sketches.some((q) => q.id === s.id))
  )
    throw Error(
      "A guided component already exists in this project. Undo its insertion before adding it from the walkthrough.",
    );
  if (
    !capStep &&
    !project.features.some((f) => f.id === "pen-cap" && !f.suppressed)
  )
    throw Error("Restore the threaded cap before attaching its clip.");
  const config = template.workspaces!;
  const joints = { ...project.workspaces?.joints };
  for (const part of parts) {
    const joint = config.joints[part.id];
    joints[part.id] = {
      ...joint,
      parent: joint.parent === "barrel-revolve" ? barrel.id : joint.parent,
      ...(joint.threadMate
        ? {
            threadMate: {
              ...joint.threadMate,
              mating: { ...joint.threadMate.mating, featureId: barrel.id },
            },
          }
        : {}),
    };
  }
  const drawing = project.workspaces?.drawing || {};
  const p: Project = {
    ...project,
    parameters: [
      ...project.parameters,
      ...template.parameters.filter(
        (a) => !project.parameters.some((b) => a.name === b.name),
      ),
    ],
    features: [
      ...project.features.map((f) =>
        capStep && f.id === barrel.id
          ? {
              ...f,
              finishes: [
                ...(f.finishes || []),
                ...template.features[0].finishes!,
              ],
            }
          : f,
      ),
      ...parts,
    ],
    sketches: [...project.sketches, ...sketches],
    workspaces: {
      ...project.workspaces,
      joints,
      bodyMaterials: {
        ...Object.fromEntries(ids.map((id) => [id, config.bodyMaterials[id]])),
        ...project.workspaces?.bodyMaterials,
      },
      assemblyClearance: {
        requiredGap: "0.04 mm",
        ...project.workspaces?.assemblyClearance,
      },
      drawing: {
        ...drawing,
        sources: {
          ["body:" + barrel.id]: config.drawing.sources["body:barrel-revolve"],
          assembly: config.drawing.sources.assembly,
          ...drawing.sources,
        },
      },
    },
  };
  return setGuide(p, { stage: capStep ? "internals" : "motion" });
}

export function recordGuideMotion(
  p: Project,
  selected: string,
  angle: number,
  lead: number,
  isMatedScrew: boolean,
) {
  const guide = penGuide(p);
  if (
    guide?.stage !== "motion" ||
    guide.paused ||
    selected !== "pen-cap" ||
    !isMatedScrew ||
    !(Math.abs(angle) > 0.001) ||
    !Number.isFinite(lead) ||
    !lead
  )
    return p;
  return setGuide(p, {
    stage: "clearance",
    rotation: angle,
    travel: (angle * lead) / 360,
  });
}

export function recordGuideClearance(
  p: Project,
  fullTravel: boolean,
  reports: ClearanceResult[],
) {
  const guide = penGuide(p);
  if (guide?.stage !== "clearance" || guide.paused || !fullTravel) return p;
  const pass = reports.find(
    (r) =>
      r.id === "pen-cap" &&
      r.pair === guide.barrelId &&
      r.status === "clear" &&
      Number.isFinite(r.lowerBound),
  );
  return pass
    ? setGuide(p, { stage: "drawing", lowerBound: pass.lowerBound })
    : p;
}

export function openGuideDrawing(p: Project) {
  const guide = penGuide(p);
  if (!guide) return p;
  const drawing = p.workspaces?.drawing || {};
  if (
    drawing.scope === "finished" &&
    drawing.feature === guide.barrelId &&
    drawing.dimensions !== false
  )
    return p;
  return {
    ...p,
    workspaces: {
      ...p.workspaces,
      drawing: {
        ...drawing,
        scope: "finished",
        feature: guide.barrelId,
        dimensions: true,
      },
    },
  };
}

export function recordGuideDrawing(
  p: Project,
  scope: string,
  featureId: string | undefined,
  dimensioned: boolean,
) {
  const guide = penGuide(p);
  return guide?.stage === "drawing" &&
    !guide.paused &&
    scope === "finished" &&
    featureId === guide.barrelId &&
    dimensioned
    ? setGuide(p, { stage: "finished" })
    : p;
}

export function refreshGuideCheck(previous: Project, next: Project) {
  const guide = penGuide(next);
  if (
    previous.id !== next.id ||
    guide?.stage !== "drawing" ||
    penGuide(previous)?.stage !== "drawing"
  )
    return next;
  // A drawing must use the geometry and mechanism that passed the full-travel test.
  const different = (a: unknown, b: unknown) =>
    a !== b && JSON.stringify(a) !== JSON.stringify(b);
  const changed =
    (["parameters", "features", "sketches", "importedFiles"] as const).some(
      (k) => different(previous[k], next[k]),
    ) ||
    ["joints", "jointPose", "scale", "assemblyClearance"].some((k) =>
      different(previous.workspaces?.[k], next.workspaces?.[k]),
    );
  return changed
    ? setGuide(next, { stage: "clearance", lowerBound: undefined })
    : next;
}
