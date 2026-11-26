import { Matrix4 } from "three";
import type { FitSurface } from "./fitSurfaces";
import { featureUsesSketch, partFeatures, savePartFeature } from "./partTabs";
import { uid } from "./projects";
import type { ThreadFrame } from "./threadMates";
import type { Feature, Project, Sketch } from "./types";
import type { WritingFit } from "./writingFit";
import { lengthText } from "./writingConeSeat";

type XYZ = [number, number, number];
type BackingFit = Pick<WritingFit, "barrelId" | "barrelAxis" | "tailPoint" | "inward" | "tailDiameter" |
  "rearEndDistance" | "rearStatus" | "rearGap" | "rearStopInnerDiameter">;
export type RefillBackingPlan =
  | { kind: "existing"; barrelId: string; gap: number }
  | {
      kind: "shoulder"; openRear: boolean; barrelId: string; axis: "X" | "Z"; centerline: XYZ;
      gap: number; faceStation: number; backStation: number; boreDiameter: number; ventDiameter: number;
    };

const tolerance = 1e-6;

function activeBarrel(project: Project, id: string) {
  const root = project.features.find(f => f.id === id && f.operation === "new" && !f.suppressed);
  if (!root) throw Error("Restore the barrel before fitting a refill backing.");
  return root;
}

/** The stop occupies the empty side of an uninterrupted, finished cylindrical bore.
 * Its OD shares the bore wall over the length of the shoulder. No radial allowance
 * is added to the tool: an allowance could fill a separate port or an outside thread. */
export function planRefillBacking(project: Project, fit: BackingFit, surfaces: FitSurface[],
  gap = 0, threadFrames: ThreadFrame[] = []): RefillBackingPlan {
  activeBarrel(project, fit.barrelId);
  if (!Number.isFinite(gap) || gap < 0)
    throw Error("Enter an endplay of zero or more for the refill backing.");
  if (fit.rearStatus === "interference") {
    if (fit.rearGap === undefined || !Number.isFinite(fit.rearGap))
      throw Error("Rebuild the barrel to measure how far the refill crosses the rear stop.");
    const overlap = -fit.rearGap;
    throw Error("At this tip projection, the refill overlaps the rear stop by " + lengthText(overlap) +
      ". Deepen the barrel bore by " + lengthText(overlap + gap) + " for " + lengthText(gap) + " rear endplay.");
  }
  if (fit.rearStatus === "unknown")
    throw Error("Provide a measurable round bore or flat rear stop behind the refill.");
  if (fit.rearStatus === "gap" || fit.rearStatus === "contact") {
    if (fit.rearGap === undefined || !Number.isFinite(fit.rearGap))
      throw Error("Rebuild the barrel to measure its rear stop.");
    if (Math.abs(fit.rearGap - gap) <= tolerance)
      return { kind: "existing", barrelId: fit.barrelId, gap: fit.rearGap };
    if (fit.rearGap < gap)
      throw Error("The existing rear stop is closer than the requested endplay. Reduce the endplay or deepen the barrel.");
  }
  const axis = fit.barrelAxis === "X" ? 0 : 2;
  if (fit.inward.length !== 3 || fit.tailPoint.length !== 3 || !fit.tailPoint.every(Number.isFinite) ||
      fit.inward.some((n, i) => !Number.isFinite(n) || Math.abs(Math.abs(n) - (i === axis ? 1 : 0)) > tolerance) ||
      !Number.isFinite(fit.tailDiameter) || fit.tailDiameter <= tolerance ||
      !Number.isFinite(fit.rearEndDistance))
    throw Error("Align the refill with a turned barrel bore and rebuild to measure its tail.");
  const sign = Math.sign(fit.inward[axis]);
  const face = fit.tailPoint[axis] + sign * gap;
  const center = fit.tailPoint.map((n, i) => i === axis ? 0 : n) as XYZ;
  const remaining = Math.min(fit.rearEndDistance, fit.rearGap ?? Infinity) - gap;
  if (remaining <= tolerance)
    throw Error("There is no barrel behind this stop location. Lengthen the barrel, reduce endplay, or choose a shorter refill.");

  const bores = surfaces.filter(b => b.bodyId === fit.barrelId && b.side === "bore" &&
    Math.abs(b.axis[axis] - 1) <= tolerance &&
    b.centerline.every((v, i) => Math.abs(v - center[i]) <= tolerance) &&
    b.start <= face + tolerance && b.end >= face - tolerance &&
    (sign > 0 ? b.end - face : face - b.start) > tolerance)
    .sort((a,b) => a.diameter - b.diameter);
  const bore = bores[0];
  if (!bore || bore.diameter < fit.tailDiameter - tolerance)
    throw Error("The stop needs a complete cylindrical bore wall behind the refill tail. Move the stop onto a round land or edit the barrel bore.");
  const landLength = sign > 0 ? bore.end - face : face - bore.start;
  // A short ring with a larger cavity behind it cannot be bored from the front
  // of a blind barrel. Carry the same section back to the original floor.
  const blind = fit.rearStatus === "gap";
  let thickness = Math.min(2, remaining, landLength), ventDiameter = fit.tailDiameter / 2;
  if (blind) {
    const floorOpening = fit.rearStopInnerDiameter, rearGap = fit.rearGap;
    if (rearGap === undefined || rearGap - gap > Math.min(landLength, remaining) + tolerance ||
        floorOpening === undefined || !Number.isFinite(floorOpening) || floorOpening < 0 ||
        floorOpening >= fit.tailDiameter - tolerance)
      throw Error("A stepped or interrupted bore lies between the refill and its rear stop. Edit the original bore depth to form a front-accessible stop.");
    thickness = rearGap - gap;
    ventDiameter = floorOpening;
  }

  // A cosmetic internal thread can leave a full smooth cylinder in the B-rep.
  // Keep the socket's entire mating length available, including its entry.
  for (const thread of threadFrames) {
    if (thread.bodyId !== fit.barrelId || thread.side !== "internal" || thread.axis !== fit.barrelAxis ||
        thread.entrance.some((v, i) => i !== axis && Math.abs(v - center[i]) > tolerance)) continue;
    const from = sign * (thread.entrance[axis] - face);
    const to = from + sign * (thread.end === "start" ? 1 : -1) * thread.length;
    if (Math.max(from, to) <= tolerance || Math.min(from, to) >= thickness - tolerance) continue;
    if (blind)
      throw Error("The backing would cover an internal thread before the blind bottom. Edit the barrel bore or move the thread clear.");
    thickness = Math.min(thickness, Math.min(from, to));
  }
  if (thickness <= tolerance)
    throw Error("The stop would block an internal thread. Move the stop clear of the threaded socket or shorten the thread.");

  return {
    kind: "shoulder", openRear: !blind, barrelId: fit.barrelId, axis: fit.barrelAxis, centerline: center, gap,
    faceStation: face, backStation: face + sign * thickness,
    boreDiameter: bore.diameter, ventDiameter,
  };
}

function generatedStops(project: Project, barrelId: string) {
  return partFeatures(project, barrelId).filter(f => f.refillBacking === true && f.operation === "add" && !f.suppressed);
}

/** Remeasure the barrel before an earlier generated stop. User-drawn shoulders
 * and shared profiles always stay in history. One journal commit applies the refit. */
export function withoutRefillBacking(project: Project, barrelId: string): Project {
  const stops = generatedStops(project, barrelId);
  if (!stops.length) return project;
  if (stops.some(f => f.finishes?.length || f.advanced || f.operations?.length))
    throw Error("Move the finishes and operations on the existing refill stop to a separate feature before replacing it.");
  const features = project.features.filter(f => !stops.includes(f));
  const sketches = project.sketches.filter(s => !stops.some(f => featureUsesSketch(f, s.id)) ||
    features.some(f => featureUsesSketch(f, s.id)));
  return { ...project, features, sketches };
}

/** A real additive feature belongs at the end of this barrel's solid history. */
export function addRefillBacking(project: Project, plan: RefillBackingPlan, prior: Project = project): Project {
  const root = activeBarrel(project, plan.barrelId);
  if (plan.kind === "existing") return project;
  const previous = generatedStops(prior, root.id)[0];
  const cleaned = withoutRefillBacking(project, root.id);
  const oldSketch = previous?.sketchId || previous?.merge?.features[0]?.sketchId;
  const sketchId = oldSketch && !cleaned.sketches.some(s => s.id === oldSketch) ? oldSketch : uid();
  const mm = (value: number) => Number(value.toPrecision(15)) + " mm";
  const { faceStation: face, backStation: back } = plan;
  const inner = plan.ventDiameter / 2, outer = plan.boreDiameter / 2;
  const sketch: Sketch = {
    id: sketchId, partId: root.id, name: "Refill rear stop profile", constraints: [],
    points: [[face, inner], [face, outer], [back, outer], [back, inner]]
      .map(([x,y]) => ({ x: mm(x), y: mm(y) })),
  };
  const turning: Feature = {
    id: previous?.id ?? uid(), name: "Refill rear stop", kind: "revolve", amount: "360 deg",
    sketchId: sketch.id, operation: "add", suppressed: false,
  };
  if (plan.axis === "X" && plan.centerline.every(n => Math.abs(n) < tolerance))
    return savePartFeature(cleaned, root, { ...turning, refillBacking: true }, sketch);

  // Offset and Z-axis bores use the same editable meridian in its own turning frame.
  // A retained native merge expresses the rigid placement without baking a B-rep.
  const transform = plan.axis === "X" ? new Matrix4() : new Matrix4().makeRotationY(-Math.PI / 2);
  transform.setPosition(...plan.centerline);
  const placed: Feature = { ...turning, refillBacking: true, kind: "merge", sketchId: "", amount: "0", bodyId: root.id,
    merge: { transform: transform.toArray(), features: [{ ...turning, id: uid(), operation: "new" }] } };
  return savePartFeature(cleaned, root, placed, sketch);
}
