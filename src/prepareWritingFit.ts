import { evaluateModel } from "./buildModel";
import { evaluate, resolveParameters } from "./expressions";
import { addRefillBacking, withoutRefillBacking } from "./refillBacking";
import { refillComponents } from "./refills";
import type { Project } from "./types";
import { lengthText, shapeWritingSeat, withoutWritingSeat, type WritingSetup } from "./writingConeSeat";
import { applyWritingPose, type WritingFit } from "./writingFit";
import type { FitProof, WritingRequest } from "./writingFitJob";
export type WritingResult = { source: Project; project: Project; proof: FitProof; summary: string; before?: string; applied?: boolean };

export async function prepareWritingFit(project: Project, setup: WritingSetup, run: WritingRequest,
  onMeasure?: (fit: WritingFit) => void): Promise<WritingResult> {
  const { projection, clearance, endplay } = setup;
  const saved: WritingSetup | undefined = project.workspaces?.writingSetups?.[setup.coneId];
  const values = resolveParameters(project.parameters);
  if (!(evaluate(clearance, values) > 0)) throw Error("Enter a positive diametral guide clearance.");
  if ((project.workspaces?.jointPose?.[setup.coneId] ?? []).some((n: number) => Math.abs(n) > 1e-6))
    throw Error("Seat the screw-on cone fully in Assembly before fitting its refill.");
  if (saved && !saved.needsRefit && saved.refillId === setup.refillId && saved.projection === projection && saved.clearance === clearance && saved.endplay === endplay) {
    try {
      const proof = await run({ action: "verify", project, setup });
      return { source: project, project, proof, applied: true, summary: "The existing seats hold this refill." };
    } catch { /* Remeasure and plan a correction when the saved build has changed. */ }
  }
  if (refillComponents(project).some(r => r.bodyId !== setup.refillId && project.workspaces?.joints?.[r.bodyId]?.parent === setup.barrelId))
    throw Error("Another refill is already attached to this barrel. Release or replace it before fitting this cartridge.");
  const base = withoutRefillBacking(withoutWritingSeat(project, setup.coneId), setup.barrelId);
  const features = base === project ? undefined : (await evaluateModel(base)).features;
  const stock = await run({ action: "measure", project: base, setup, features });
  const { fit, backing } = stock;
  onMeasure?.(fit);
  if (!backing) throw Error(stock.problem || "The barrel needs a measurable rear stop.");
  const shaped = stock.frontSeated ? undefined : shapeWritingSeat(base, fit, setup);
  const front = shaped?.project ?? { ...base, workspaces: { ...base.workspaces, writingSetups: { ...base.workspaces?.writingSetups, [setup.coneId]: setup } } };
  const next = applyWritingPose(addRefillBacking(front, backing, project), fit);
  const proof = await run({ action: "verify", project: next, setup, features: (await evaluateModel(next)).features });
  const seat = !shaped ? "Use the existing cone seat" : shaped.dimensions.extension ? "Extend the cone seat " + lengthText(shaped.dimensions.extension)
    : shaped.dimensions.relief ? "Counterbore the cone to Ø" + lengthText(shaped.dimensions.relief) : "Seat the refill against the back of the cone";
  const summary = seat + " and " + (backing.kind === "existing" ? "reuse the existing rear stop."
    : (backing.ventDiameter > 0 ? "form a vented rear stop in the barrel." : "form a solid rear stop in the barrel."));
  const before = fit.currentAlignment === "aligned" ? "Current tip projection " + lengthText(fit.currentExposure!) + "."
    : fit.currentAlignment === "reversed" ? "The refill currently points away from the writing end." : "The refill is currently off the cone axis.";
  return { source: project, project: next, proof, summary, before };
}
