import { evaluate, resolveParameters } from "./expressions";
import { threadMinorDiameter } from "./finishingTypes";
import { featureUsesSketch, partFeatures, savePartFeature } from "./partTabs";
import { uid } from "./projects";
import { isSleeveDonor, refillComponents, refillDimensions } from "./refills";
import { screwConeProfile } from "./screwConeProfile";
import type { Feature, Project, Sketch } from "./types";
import type { WritingFit } from "./writingFit";

export const lengthText = (n: number) => Number(n.toFixed(6)) + " mm";
export type WritingSetup = {
  coneId: string; barrelId: string; refillId: string; projection: string;
  clearance: string; endplay: string; seatFeatureId?: string; needsRefit?: boolean;
};

export function withoutWritingSeat(project: Project, coneId: string) {
  const setup: WritingSetup | undefined = project.workspaces?.writingSetups?.[coneId];
  const seat = partFeatures(project, coneId).find(f => f.id === setup?.seatFeatureId && f.bodyId === coneId && f.writingSeat);
  if (!seat) return project;
  if (seat.suppressed || seat.finishes?.length || seat.operations?.length || seat.advanced)
    throw Error("The earlier refill seat has been suppressed or has extra machining. Restore it or move those operations before refitting.");
  const features = project.features.filter(f => f !== seat);
  return { ...project, features, sketches: project.sketches.filter(s => s.id !== seat.sketchId || features.some(f => featureUsesSketch(f, s.id))) };
}

/** The first substantial increase past the metal guide gives a positive axial seat.
 * The nose remains removable, so the refill can be fed through its rear opening. */
export function shapeWritingSeat(project: Project, fit: WritingFit, setup: WritingSetup) {
  const root = project.features.find(f => f.id === fit.coneId)!;
  const sketch = project.sketches.find(s => s.id === root.sketchId);
  const cone = screwConeProfile(project, sketch, root);
  const refill = refillComponents(project).find(r => r.bodyId === fit.refillId);
  const d = refillDimensions(project, fit.refillId);
  if (!cone?.tenon || !sketch || !refill || !d || isSleeveDonor(refill.kind))
    throw Error("Choose a generated screw-on cone and a cartridge with a tip guide. BIC front inserts use their own press-in collar in Assembly.");
  const active = partFeatures(project, root.id).filter(f => !f.suppressed);
  if (active.length !== 1 || root.operations?.some(op => !op.suppressed) || root.advanced || root.finishes?.some(f => !f.suppressed && f.id !== cone.tenon!.id))
    throw Error("This cone has custom machining. Inspect its existing shoulders before replacing the bore with a refill seat.");
  const values = resolveParameters(project.parameters);
  const clearance = evaluate(setup.clearance, values);
  const guide = d.guide_diameter + clearance;
  const neckAtShoulder = refill.kind === "bic-cristal" ? d.body_diameter : d.neck_diameter;
  const firstSeat = neckAtShoulder > guide + 0.1;
  const shoulder = firstSeat ? d.shoulder_distance : d.body_start;
  const stopDiameter = firstSeat ? neckAtShoulder : d.reservoir_front_diameter;
  if (!(clearance > 0 && guide + 0.1 < stopDiameter))
    throw Error("Reduce guide clearance so the refill shoulder has a bearing face around the guide.");
  const tipExpr = sketch.points[2].x, baseExpr = sketch.points[0].x;
  const fromTip = (distance: string) => "(" + tipExpr + ")" + (fit.coneInward > 0 ? " + " : " - ") + "(" + distance + ")";
  const station = shoulder - fit.requestedExposure;
  const coneLength = Math.abs(evaluate(baseExpr, values) - evaluate(tipExpr, values));
  const tenon = cone.tenon, threadLength = evaluate(tenon.length, values);
  const total = coneLength + threadLength;
  const rootDiameter = threadMinorDiameter(evaluate(tenon.diameter, values), evaluate(tenon.pitch, values));
  const tipOD = 2 * evaluate(cone.tipRadius, values), baseOD = 2 * evaluate(cone.baseRadius, values);
  if (guide + 0.3 > tipOD) throw Error("Increase the cone tip outside diameter to at least " + lengthText(guide + 0.3) + " to leave a wall around the writing guide.");
  if (station <= 0 || guide + 0.3 > rootDiameter) throw Error("This guide needs more material in the cone or its threaded tenon.");
  const prefix = refill.prefix;
  const newOpening = prefix + "_guide_diameter + (" + setup.clearance + ")";
  let next: Project = { ...project, parameters: project.parameters.map(p => p.name === cone.opening ? { ...p, expression: newOpening } : p) };
  const stockRear = "(" + baseExpr + ")" + (fit.coneInward > 0 ? " + " : " - ") + "(" + tenon.length + ")";
  const shoulderAt = fromTip(prefix + (firstSeat ? "_shoulder_distance" : "_body_start") + " - (" + setup.projection + ")");
  const dimensions = { guide, station, relief: 0, extension: 0 };
  let feature: Feature | undefined;
  if (Math.abs(station - total) > 1e-5) {
    const extend = station > total;
    let size: string;
    if (extend) {
      // Retain the cartridge at the rear face of a short pilot that extends inside the barrel.
      dimensions.extension = station - total;
      size = prefix + "_guide_diameter + (" + setup.clearance + ") + 1 mm";
      if (evaluate(size, values) >= rootDiameter) throw Error("The cone tenon is too thin to carry an internal seat extension.");
    } else {
      const endOnRefill = total + fit.requestedExposure;
      const includesBody = endOnRefill > d.body_start + 1e-5;
      size = prefix + (includesBody ? "_body_diameter" : "_neck_diameter");
      if (refill.kind === "bic-cristal") size = prefix + "_body_diameter";
      if (d.neck_diameter > evaluate(size, values)) size = prefix + "_neck_diameter";
      size += " + (" + setup.clearance + ")";
      dimensions.relief = evaluate(size, values);
      const seatOD = tipOD + (baseOD - tipOD) * Math.min(1, station / coneLength);
      if (dimensions.relief + 0.3 > Math.min(seatOD, rootDiameter))
        throw Error("The required rear counterbore would break into the cone or thread. Increase the cone wall or choose a slimmer refill.");
    }
    const name = extend ? "Refill seat extension" : "Refill shoulder counterbore";
    const inner = extend ? "(" + newOpening + ") / 2" : "0 mm";
    const outer = "(" + size + ") / 2";
    const profile: Sketch = { id: uid(), partId: root.id, name: name + " profile", constraints: [], points: [
      { x: stockRear, y: inner }, { x: stockRear, y: outer }, { x: shoulderAt, y: outer }, { x: shoulderAt, y: inner },
    ] };
    feature = { id: uid(), name, kind: "revolve", operation: extend ? "add" : "cut",
      writingSeat: true, sketchId: profile.id, amount: "360 deg", suppressed: false, bodyId: root.id };
    next = savePartFeature(next, root, feature, profile);
  }
  const record: WritingSetup = { ...setup, seatFeatureId: feature?.id };
  next.workspaces = { ...next.workspaces, writingSetups: { ...next.workspaces?.writingSetups, [root.id]: record } };
  return { project: next, dimensions };
}
