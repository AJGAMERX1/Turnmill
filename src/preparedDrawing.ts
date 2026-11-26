import type { Shape3D } from "replicad";
import { buildBodies, releaseBodies, type Body } from "./geometry";
import {
  exteriorDrawing,
  partSection,
  cutAssemblySection,
  type SectionPlaneSpec,
} from "./secondaryProjection";
import { projectAssemblyDrawing } from "./assemblyDrawingProjection";
import { positioned } from "./motionGeometry";
import type { EvaluatedFeature, Parameter } from "./types";
import { resolveParameters } from "./expressions";
import { hasModeledThread } from "./finishingTypes";
import { bodyIds, buildPoses, type JointConfig } from "./kinematics";
import { resolveThreadMates } from "./threadMates";

export type DrawingSource = {
  features: EvaluatedFeature[];
  joints?: JointConfig;
  values: Record<string, number>;
  parameters?: Parameter[];
  modeled: boolean;
};
export type DrawingBase =
  | { part: ReturnType<typeof exteriorDrawing> }
  | { assembly: ReturnType<typeof projectAssemblyDrawing> };
export type DrawingCut =
  | { part: ReturnType<typeof partSection> }
  | { assembly?: ReturnType<typeof cutAssemblySection> };
export type PreparedDrawing = {
  base: DrawingBase;
  cut: (plane?: SectionPlaneSpec) => DrawingCut;
  dispose: () => void;
};

export function cosmeticThreads(f: EvaluatedFeature): EvaluatedFeature {
  return {
    ...f,
    finishes: f.finishes?.map((g) =>
      g.kind === "thread" ? { ...g, mode: "cosmetic" } : g,
    ),
    merge: f.merge && {
      ...f.merge,
      features: f.merge.features.map(cosmeticThreads),
    },
  };
}

/** Exact solids live in the drawing worker only as long as this source stays open. */
export function prepareDrawing(
  {
    features,
    joints,
    values: numericValues,
    parameters,
    modeled,
  }: DrawingSource,
  borrowed?: { exact: Body[]; simplified?: Body[] },
): PreparedDrawing {
  const values = parameters ? resolveParameters(parameters) : numericValues;
  const simplified = !modeled && features.some(hasModeledThread);
  const bodies = borrowed?.exact ?? buildBodies(features);
  const exact: Shape3D[] = [],
    display: Shape3D[] = [];
  const dispose = () => exact.splice(0).forEach((s) => s.delete());
  try {
    const screen = simplified
      ? (borrowed?.simplified ?? buildBodies(features.map(cosmeticThreads)))
      : undefined;
    try {
      if (!joints) {
        if (bodies.length !== 1)
          throw Error("Choose a single body to generate its sheet.");
        const base = exteriorDrawing(bodies[0].shape, screen?.[0].shape);
        exact.push(bodies[0].shape.clone());
        return {
          base: { part: base },
          cut: (plane = { axis: "Y", offset: 0 }) => ({
            part: partSection(exact[0], base.bounds, plane),
          }),
          dispose,
        };
      }
      const ids = bodyIds(features);
      const resolved = resolveThreadMates(
        joints,
        bodies.flatMap((b) => b.threadFrames || []),
        values,
        ids,
      );
      const matrices = buildPoses(ids, resolved, {}, values);
      for (let i = 0; i < bodies.length; i++) {
        exact.push(positioned(bodies[i].shape, matrices[i]));
        if (screen) display.push(positioned(screen[i].shape, matrices[i]));
      }
      const assembly = projectAssemblyDrawing(
        screen ? display : exact,
        ids,
        bodies.map((b) => b.name),
        resolved,
        matrices,
        simplified,
        exact,
      );
      return {
        base: { assembly },
        cut: (plane) => ({
          assembly: plane
            ? cutAssemblySection(exact, ids, assembly.bounds, plane)
            : undefined,
        }),
        dispose,
      };
    } finally {
      if (screen && screen !== borrowed?.simplified) releaseBodies(screen);
    }
  } catch (e) {
    dispose();
    throw e;
  } finally {
    display.forEach((s) => s.delete());
    if (!borrowed) releaseBodies(bodies);
  }
}
