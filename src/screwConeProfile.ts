import { evaluate, resolveParameters } from "./expressions";
import { threadMinorDiameter, type Finish } from "./finishingTypes";
import type { Feature, Project, Sketch } from "./types";

type Values = Record<string, number>;
type Tenon = Extract<Finish, { kind: "thread" }>;

export type ScrewConeProfile = {
  prefix: string;
  opening: string;
  tip?: string;
  base?: string;
  length?: string;
  tipRadius: string;
  baseRadius: string;
  tenon?: Tenon;
};

const compact = (expression: string) => expression.replace(/\s+/g, "");

/** Older projects identify the generated bore by its two meridian vertices and mating tenon. */
export function screwConeProfile(project: Project, sketch?: Sketch, feature?: Feature): ScrewConeProfile | undefined {
  if (!sketch || sketch.points.length !== 4 || sketch.constraints.length !== 0) return;
  const [rearBore, rearRim, tipRim, tipBore] = sketch.points;
  const opening = compact(rearBore.y);
  const prefix = /^(cone\d*)_opening\/2$/.exec(opening)?.[1];
  if (!prefix || compact(tipBore.y) !== opening || compact(rearBore.x) !== compact(rearRim.x)
    || compact(tipBore.x) !== compact(tipRim.x)) return;

  const owner = feature ?? project.features.find(f => f.operation === "new" && f.sketchId === sketch.id
    && (!sketch.partId || f.id === sketch.partId));
  if (owner?.kind !== "revolve" || owner.operation !== "new" || owner.sketchId !== sketch.id) return;
  const tenon = owner.finishes?.find((op): op is Tenon =>
    op.kind === "thread" && op.side === "external" && op.preparation === "tenon");
  const length = prefix + "_length", base = prefix + "_base", tip = prefix + "_tip";
  const baseX = compact(rearBore.x), tipX = compact(tipRim.x);
  const drivenLength = tipX === baseX + "+" + length || tipX === baseX + "-" + length;
  const drivenTip = compact(tipRim.y) === tip + "/2", drivenBase = compact(rearRim.y) === base + "/2";
  // A generic diameter edit can detach a rim coordinate from the named parameter.
  // Keep reading that physical rim. A hand-drawn sketch needs no cone-specific rules.
  const generatedTenon = tenon && (tenon.pitch === prefix + "_pitch" || tenon.length === prefix + "_thread_length");
  const hasMatingJoint = !!project.workspaces?.joints?.[owner.id]?.threadMate;
  if (!generatedTenon && !(drivenTip && drivenBase && drivenLength && (tenon || hasMatingJoint))) return;
  return {
    prefix, opening: prefix + "_opening", tip: drivenTip ? tip : undefined,
    base: drivenBase ? base : undefined, length: drivenLength ? length : undefined,
    tipRadius: tipRim.y, baseRadius: rearRim.y, tenon: tenon?.suppressed ? undefined : tenon,
  };
}

function coneProblem(cone: ScrewConeProfile, values: Values): string | undefined {
  const bore = evaluate(cone.opening, values);
  const tip = 2 * evaluate(cone.tipRadius, values), base = 2 * evaluate(cone.baseRadius, values);
  const mm = (n: number) => Number(n.toPrecision(12)) + " mm";
  if (bore < 0) return "Enter a cone bore diameter of zero or more.";
  if (bore >= tip)
    return `The cone bore diameter (${mm(bore)}) must be smaller than the tip outside diameter (${mm(tip)}). Reduce the bore or increase the tip outside diameter to leave a wall.`;
  if (bore >= base)
    return `The cone bore diameter (${mm(bore)}) must be smaller than the base outside diameter (${mm(base)}). Reduce the bore or increase the base outside diameter.`;
  if (cone.tenon) {
    const root = threadMinorDiameter(evaluate(cone.tenon.diameter, values), evaluate(cone.tenon.pitch, values));
    if (bore >= root) return `The cone bore diameter (${mm(bore)}) reaches the thread root (${mm(root)}). Reduce the bore or choose a thread with a larger root diameter.`;
  }
}

/** Validate only active solids, including the source histories retained inside a merge. */
export function validateProjectScrewCones(project: Project, values: Values, previous?: Project): void {
  function problems(doc: Project, params: Values) {
    const issues = new Map<string, string>();
    const sketches = new Map(doc.sketches.map(s => [s.id, s]));
    function visit(features: Feature[]) {
      for (const f of features) {
        if (f.suppressed) continue;
        if (f.merge) visit(f.merge.features);
        if (f.kind !== "revolve" || f.operation !== "new") continue;
        const cone = screwConeProfile(doc, sketches.get(f.sketchId), f);
        const issue = cone && coneProblem(cone, params);
        if (issue) issues.set(f.id, f.name + " — " + issue);
      }
    }
    visit(doc.features);
    return issues;
  }
  const current = problems(project, values);
  if (!current.size) return;
  let existing: Map<string, string> | undefined;
  if (previous) {
    // An unrelated edit can still be saved while an older cone awaits repair.
    try { existing = problems(previous, resolveParameters(previous.parameters)); }
    catch { /* An old invalid expression cannot establish an unchanged dimension. */ }
  }
  for (const [id, issue] of current) if (existing?.get(id) !== issue) throw Error(issue);
}
