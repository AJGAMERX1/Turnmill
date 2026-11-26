import { evaluateModel } from "./buildModel";
import { resolveParameters } from "./expressions";
import { prepareWritingFit, type WritingResult } from "./prepareWritingFit";
import { planSlimAttachments } from "./slimAttachments";
import { readSlimAllowances, type SlimSettings } from "./slimSizing";
import { narrowBarrel, slimBarrelFloor } from "./slimBarrel";
import type { JointConfig } from "./kinematics";
import type { CapMount } from "./threadedCone";
import type { Project } from "./types";
import { lengthText, type WritingSetup } from "./writingConeSeat";
import type { WritingRequest } from "./writingFitJob";

function checkParts(project: Project, setup: WritingSetup) {
  const caps = Object.entries((project.workspaces?.capMounts ?? {}) as Record<string, CapMount>)
    .filter(([, m]) => m.barrelId === setup.barrelId).map(([id]) => id);
  const known = new Set([setup.barrelId, setup.coneId, setup.refillId, ...caps]);
  for (const [id, joint] of Object.entries((project.workspaces?.joints ?? {}) as JointConfig)) {
    if (!joint.parent || known.has(id) === known.has(joint.parent)) continue;
    const part = project.features.find(f => f.id === (known.has(id) ? joint.parent : id) && !f.suppressed);
    if (part) throw Error(part.name + " has a separate attachment to this pen. Check its mounting diameter and detach it before slimming.");
  }
}

export async function previewSlimPen(project: Project, setup: WritingSetup, settings: SlimSettings, run: WritingRequest,
  getFit: () => Promise<WritingResult> = () => prepareWritingFit(project, setup, run)) {
  const values = resolveParameters(project.parameters);
  const { wall, clearance, allowance } = readSlimAllowances(settings, values);
  checkParts(project, setup);
  const fitted = await getFit();
  // Round off only the kernel's sub-micron bounding-box noise.
  const widest = Number(fitted.proof.diameters.refill.toFixed(6));
  const bore = widest + clearance;
  const requested = settings.method === "diameter" ? widest + allowance : bore + 2 * wall;
  const boreExpression = widest + " mm + (" + settings.runningClearance + ")";
  const requestedExpression = settings.method === "diameter"
    ? widest + " mm + (" + settings.allowance + ")" : "(" + boreExpression + ") + 2 * (" + settings.wall + ")";
  const current = fitted.proof.diameters.barrel;
  const floor = slimBarrelFloor(fitted.project, setup.barrelId, bore, wall);
  const attachments = planSlimAttachments(fitted.project, {
    barrelId: setup.barrelId, coneId: setup.coneId, boreDiameter: bore, minimumWall: wall,
    requestedDiameter: Math.max(Math.min(current, requested), floor), diameterExpression: requestedExpression,
  });
  const diameter = attachments.appliedDiameter;
  if (diameter > current + 0.00001)
    throw Error("The current barrel is Ø" + lengthText(current) + ". This wall and thread pair need Ø" +
      lengthText(diameter) + ". Reduce the wall or change the mating threads to slim this pen.");
  const sizeExpression = Math.abs(diameter - requested) < 1e-6 ? requestedExpression : diameter;
  const nextStock = narrowBarrel(attachments.project, setup.barrelId, sizeExpression, boreExpression, resolveParameters(attachments.project.parameters), wall);
  const next: Project = { ...nextStock, workspaces: { ...nextStock.workspaces, slimPens: {
    ...nextStock.workspaces?.slimPens, [setup.barrelId]: { ...settings, refillId: setup.refillId, coneId: setup.coneId },
  } } };
  const proof = await run({ action: "verify", project: next, setup, slim: true, features: (await evaluateModel(next)).features });
  if (proof.barrelEnds.some((station, i) => Math.abs(station - fitted.proof.barrelEnds[i]) > 0.00001))
    throw Error("The barrel length changes through a shared diameter parameter. Give its length an independent dimension before slimming.");
  const made = proof.diameters;
  if ([made.barrel, ...made.caps].some(d => Math.abs(d - diameter) > 0.001) || made.cone > diameter + 0.001 ||
      Math.abs(made.refill - widest) > 0.001 || !proof.barrelBores.some(d => Math.abs(d - bore) < 0.001))
    throw Error("The rebuilt parts measure differently from the proposed diameters. Check the turned profile and its finishes.");
  const limitingReason = floor > attachments.minimumDiameter + 0.00001
    ? "The barrel profile and its machined cuts need the selected wall." : attachments.limitingReason;
  const original = fitted.proof.diameters;
  return { project: next, proof, widest, bore, requested, diameter, previous: Math.max(original.barrel, original.cone, ...original.caps),
    wall, limitingReason, coneThread: attachments.coneThread, capThreads: attachments.capThreads, addsWritingFit: !fitted.applied };
}
