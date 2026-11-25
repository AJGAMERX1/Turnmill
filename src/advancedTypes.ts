import type { EvaluatedTransform } from "./advancedTransforms";
import type { EvaluatedProfileAdvanced } from "./advancedProfiles";
import { evaluate } from "./expressions";
import { solveSketch } from "./solveSketch";
import type { Project } from "./types";

export type Axis3 = "X" | "Y" | "Z";
export type FaceSide = "xMin" | "xMax" | "yMin" | "yMax" | "zMin" | "zMax";
export type SketchMode = "replace" | "add" | "cut";
export type Advanced =
  | { kind: "shell"; face: FaceSide; thickness: string }
  | {
      kind: "mirror";
      plane: "XY" | "YZ" | "XZ";
      offset: string;
      keepOriginal: boolean;
    }
  | { kind: "linearPattern"; axis: Axis3; count: string; spacing: string }
  | { kind: "circularPattern"; axis: Axis3; count: string; stepAngle: string }
  | {
      kind: "loft";
      mode: SketchMode;
      lowerId: string;
      upperId: string;
      z1: string;
      z2: string;
    }
  | {
      kind: "sweep";
      mode: SketchMode;
      sectionId: string;
      pathId: string;
      firstVertex: number;
      lastVertex: number;
      direction: "forward" | "reverse";
      anchorX: string;
      anchorY: string;
      z: string;
    };

export type EvaluatedAdvanced = EvaluatedTransform | EvaluatedProfileAdvanced;
export const advancedLabels: Record<Advanced["kind"], string> = {
  shell: "Shell",
  mirror: "Mirror",
  linearPattern: "Linear pattern",
  circularPattern: "Circular pattern",
  sweep: "Sweep",
  loft: "Loft",
};

export async function evaluateAdvanced(
  op: Advanced,
  project: Project,
  values: Record<string, number>,
): Promise<EvaluatedAdvanced> {
  const length = (v: string) => evaluate(v, values);
  const count = (v: string) => {
    const n = evaluate(v, values, "scalar");
    if (!Number.isSafeInteger(n) || n < 2)
      throw Error(
        "A pattern needs a whole number of at least two instances, including the original.",
      );
    if (n > 512) throw Error("Use up to 512 instances in one pattern.");
    return n;
  };
  const solve = async (id: string) => {
    const sketch = project.sketches.find((s) => s.id === id);
    if (!sketch) throw Error("Select an existing sketch for this operation.");
    return solveSketch(sketch, values);
  };
  if (!op || typeof op !== "object" || !Object.hasOwn(advancedLabels, op.kind))
    throw Error("The feature contains an unknown advanced operation.");
  switch (op.kind) {
    case "shell": {
      const thickness = length(op.thickness);
      if (!["xMin", "xMax", "yMin", "yMax", "zMin", "zMax"].includes(op.face))
        throw Error("Choose a face on one of the six sides of the body.");
      if (!(thickness > 0))
        throw Error("Enter a positive inward wall thickness.");
      return { kind: op.kind, face: op.face, thickness };
    }
    case "mirror": {
      if (
        !["XY", "YZ", "XZ"].includes(op.plane) ||
        typeof op.keepOriginal !== "boolean"
      )
        throw Error(
          "Choose a mirror plane and whether to keep the original body.",
        );
      return {
        kind: op.kind,
        plane: op.plane,
        offset: length(op.offset),
        keepOriginal: op.keepOriginal,
      };
    }
    case "linearPattern":
    case "circularPattern": {
      if (!["X", "Y", "Z"].includes(op.axis))
        throw Error("Choose X, Y, or Z as the pattern axis.");
      const n = count(op.count);
      if (op.kind === "linearPattern") {
        const spacing = length(op.spacing);
        if (Math.abs(spacing) < 1e-7)
          throw Error("Enter a nonzero distance between copies.");
        return { kind: op.kind, axis: op.axis, count: n, spacing };
      }
      const stepAngle = evaluate(op.stepAngle, values, "angle");
      if (Math.abs(stepAngle % 360) < 1e-8)
        throw Error("Choose an angle between copies other than a whole turn.");
      return { kind: op.kind, axis: op.axis, count: n, stepAngle };
    }
    case "loft":
    case "sweep": {
      if (!["replace", "add", "cut"].includes(op.mode))
        throw Error("Choose how the generated solid affects this body.");
      if (op.kind === "loft") {
        const z1 = length(op.z1),
          z2 = length(op.z2);
        if (Math.abs(z2 - z1) < 1e-7)
          throw Error("Place the two loft sections at different Z heights.");
        const a = await solve(op.lowerId),
          b = op.lowerId === op.upperId ? a : await solve(op.upperId);
        return {
          kind: op.kind,
          mode: op.mode,
          lower: a.edges,
          upper: b.edges,
          z1,
          z2,
        };
      }
      const section = await solve(op.sectionId),
        spine = op.pathId === op.sectionId ? section : await solve(op.pathId);
      const n = spine.vertices.length;
      if (
        ![op.firstVertex, op.lastVertex].every(
          (i) => Number.isInteger(i) && i >= 0 && i < n,
        )
      )
        throw Error(
          "Choose a start and end vertex that still exist in the path sketch.",
        );
      if (op.firstVertex === op.lastVertex)
        throw Error(
          "Choose different start and end vertices for an open sweep path.",
        );
      if (op.direction !== "forward" && op.direction !== "reverse")
        throw Error("Choose a direction along the path sketch.");
      const path = [],
        segments = new Map(spine.edges.map((e) => [e.start, e]));
      let i = op.firstVertex;
      while (i !== op.lastVertex) {
        const forward = op.direction === "forward",
          next = (i + (forward ? 1 : n - 1)) % n;
        const edge = segments.get(spine.vertices[forward ? i : next]);
        if (!edge)
          throw Error(
            "The selected path includes a collapsed edge. Choose other path vertices.",
          );
        path.push(
          forward
            ? edge
            : { start: edge.end, end: edge.start, through: edge.through },
        );
        i = next;
      }
      return {
        kind: op.kind,
        mode: op.mode,
        section: section.edges,
        path,
        z: length(op.z),
        anchor: { x: length(op.anchorX), y: length(op.anchorY) },
      };
    }
  }
}
