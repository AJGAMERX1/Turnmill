import type { Shape3D } from "replicad";
import type { EvaluatedAdvanced } from "./advancedTypes";
import { applyTransform } from "./advancedTransforms";
import { applyProfileAdvanced } from "./advancedProfiles";
export { evaluateAdvanced } from "./advancedTypes";

/** Return a new owned result. The caller can safely retain the input if this operation fails. */
export function applyAdvanced(body: Shape3D, op: EvaluatedAdvanced): Shape3D {
  return op.kind === "sweep" || op.kind === "loft"
    ? applyProfileAdvanced(body, op)
    : applyTransform(body, op);
}
