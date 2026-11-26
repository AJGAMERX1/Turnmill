import { evaluate, resolveParameters } from "./expressions";
import { validateCapProfile } from "./capProfile";
import { threadMinorDiameter, threadPresets, type Finish } from "./finishingTypes";
import { featureUsesSketch, partFeatures } from "./partTabs";
import { screwConeProfile } from "./screwConeProfile";
import type { CapMount } from "./threadedCone";
import type { Joint, JointConfig } from "./kinematics";
import type { Project, Sketch } from "./types";

type Thread = Extract<Finish, { kind: "thread" }>;
type Values = Record<string, number>;
type Size = { label: string; diameter: number; pitch: number };
export type SlimAttachmentOptions = {
  barrelId: string; coneId: string; boreDiameter: number; requestedDiameter: number; minimumWall: number; diameterExpression?: string;
};
const eps = 1e-6;
const clearOverCone = 0.2;
const mm = (n: number) => Number(n.toFixed(8)) + " mm";
const sizes = threadPresets.map(p => ({ label: p.label, diameter: evaluate(p.diameter, {}), pitch: evaluate(p.pitch, {}) }));

function boundThread(project: Project, ref: { featureId: string; finishId: string } | undefined) {
  const finish = project.features.find(f => f.id === ref?.featureId && !f.suppressed)?.finishes?.find(f =>
    f.id === ref?.finishId && !f.suppressed);
  return finish?.kind === "thread" ? finish : undefined;
}

/** Both sides must still be driven by the generator's shared major diameter and pitch. */
function threadPair(project: Project, mate: Joint | undefined, parentId: string, prefix: string, cap: boolean) {
  const a = boundThread(project, mate?.threadMate?.moving), b = boundThread(project, mate?.threadMate?.mating);
  const male = cap ? b : a, female = cap ? a : b;
  if (mate?.parent !== parentId || !male || !female || male.side !== "external" || female.side !== "internal" ||
    male.preparation !== (cap ? "flush" : "tenon") || female.preparation !== "socket" ||
    male.pitch !== prefix + "_pitch" || female.pitch !== male.pitch ||
    male.length !== prefix + "_thread_length" || female.length !== male.length ||
    female.diameter !== prefix + "_major" || male.diameter.replace(/\s+/g, "") !== prefix + "_major-" + prefix + "_allowance")
    throw Error("Slim pen needs the original linked threads. Restore the screw-on pair and convert raised cap collars to a flush fit.");
  return { male, female };
}

function familySizes(prefix: string, female: Thread, values: Values) {
  const major = values[prefix + "_major"], step = values[prefix + "_pitch"];
  const preset = sizes.find(s => s.label === female.preset);
  const metric = preset?.label.startsWith("M") ?? true;
  const options = sizes.filter(s => s.label.startsWith("M") === metric);
  if (!options.some(s => Math.abs(s.diameter - major) < eps && Math.abs(s.pitch - step) < eps))
    options.push({ label: "Custom", diameter: major, pitch: step });
  return options.sort((a, b) => Number(a.diameter > major + eps) - Number(b.diameter > major + eps) ||
    Math.abs(major - a.diameter) - Math.abs(major - b.diameter) ||
    Math.abs(step - a.pitch) - Math.abs(step - b.pitch));
}

function threadLabel(size: Size) {
  return size.label === "Custom" ? "Custom Ø" + mm(size.diameter) + " × " + mm(size.pitch) + " pitch" : size.label;
}

function allowable(size: Size, allowance: number, engagement: number) {
  return allowance >= 0 && allowance < size.diameter - threadMinorDiameter(size.diameter, size.pitch) - eps &&
    size.pitch <= engagement + eps;
}

/** A saved cap can still carry its generator metadata after a point or a constraint was edited. */
function verifyCapMeridian(sketch: Sketch, values: Values) {
  const { prefix, crown: style } = sketch.capProfile!;
  const read = (s: string) => values[prefix + "_" + s];
  const r = read("diameter") / 2, inside = threadMinorDiameter(read("major"), read("pitch")) / 2;
  const length = read("length"), crown = style === "flat" ? 0 : read("crown");
  const roof = length - crown - read("wall");
  const section = [[0, inside], [0, r], [length - crown, r]];
  if (style === "tapered") section.push([length, r / 2]);
  section.push([length, 0], [roof, 0], [roof, inside]);
  const points = sketch.points.map(p => [evaluate(p.x, values), evaluate(p.y, values)]);
  if (points.length !== section.length) throw Error("Restore the generated cap profile before slimming its walls.");
  const start = points[0][0], sign = Math.sign(points.at(-3)![0] - start);
  const sameSection = points.every(([x,y],i) =>
    Math.abs((x - start) * sign - section[i][0]) <= eps && Math.abs(y - section[i][1]) <= eps);
  const [arc] = sketch.constraints;
  const expectedArc = style === "domed" && arc?.type === "arc" && arc.indices[0] === 2 && arc.value &&
    Math.abs(evaluate(arc.value, values) - sign * (r * r + crown * crown) / (2 * crown)) <= eps;
  if (!sameSection || (style === "domed" ? sketch.constraints.length !== 1 || !expectedArc : sketch.constraints.length !== 0))
    throw Error("The cap profile has a custom wall, crown or cavity. Size its finished section independently before slimming.");
}

function capForBarrel(project: Project, barrelId: string, joints: JointConfig) {
  const mountRecords: Record<string, CapMount> = project.workspaces?.capMounts ?? {};
  const roots = project.features.filter(f => f.operation === "new" && !f.suppressed &&
    (mountRecords[f.id]?.barrelId === barrelId || joints[f.id]?.parent === barrelId && joints[f.id]?.threadMate));
  const caps = roots.flatMap(f => {
    const sketch = project.sketches.find(s => s.id === f.sketchId);
    if (!sketch?.capProfile) return [];
    if (f.kind !== "revolve" || project.features.some(step => step !== f && featureUsesSketch(step, sketch.id)) ||
      partFeatures(project, f.id).some(step => !step.suppressed && (step !== f || step.advanced ||
      step.operations?.some(o => !o.suppressed) || step.finishes?.some(op => !op.suppressed && op.id !== joints[f.id]?.threadMate?.moving.finishId))))
      throw Error("This cap has custom machining. Size its walls independently before slimming the pen.");
    const profile = sketch.capProfile, mount = mountRecords[f.id], prefix = profile.prefix;
    const pairs = (mount ? [mount.ends.start, mount.ends.end] : [joints[f.id]]).map(j => threadPair(project, j, barrelId, prefix, true));
    return [{ id: f.id, prefix, profile, sketch, pairs, amount: f.amount }];
  });
  if (caps.length > 1) throw Error("This barrel has multiple independent caps. Size one paired cap at a time.");
  return caps[0];
}

function readSeat(project: Project, coneId: string, sketch: Sketch, values: Values, wall: number) {
  const history = partFeatures(project, coneId).filter(f => !f.suppressed);
  const root = history[0], profile = screwConeProfile(project, sketch, root);
  if (!profile?.tenon || !profile.base || !profile.tip || !profile.length || !root || root.advanced ||
    project.features.some(f => f !== root && featureUsesSketch(f, sketch.id)) || evaluate(root.amount, values, "angle") !== 360 ||
    root.operations?.some(o => !o.suppressed) || root.finishes?.some(f => !f.suppressed && f.id !== profile.tenon!.id))
    throw Error("Choose the generated screw-on cone with its original tip and base diameter drivers.");
  const guide = values[profile.opening], originalTip = values[profile.tip], length = values[profile.length];
  const seat = history[1], seatSketch = seat && project.sketches.find(s => s.id === seat.sketchId);
  let relief = 0, fraction = 1, pilot = 0;
  if (seat) {
    const setup = project.workspaces?.writingSetups?.[coneId];
    if (history.length !== 2 || !seat.writingSeat || seat.id !== setup?.seatFeatureId || !seatSketch ||
      project.features.some(f => f !== seat && featureUsesSketch(f, seatSketch.id)) ||
      seatSketch.constraints.length || seatSketch.points.length !== 4 || seat.advanced || seat.operations?.length || seat.finishes?.length)
      throw Error("The cone has additional machining. Verify its finished wall before resizing it.");
    const [a, b, c, d] = seatSketch.points;
    if (a.x !== b.x || a.y !== d.y || b.y !== c.y || c.x !== d.x || seat.kind !== "revolve" ||
      evaluate(seat.amount, values, "angle") !== 360) throw Error("Restore the generated cylindrical refill seat before slimming its cone.");
    const outer = 2 * evaluate(b.y, values);
    if (seat.operation === "cut") {
      relief = outer;
      fraction = Math.min(1, Math.abs(evaluate(c.x, values) - evaluate(sketch.points[2].x, values)) / length);
    } else if (seat.operation === "add") {
      const inner = 2 * evaluate(a.y, values);
      pilot = Math.max(outer, inner + 2 * wall);
    } else throw Error("The refill seat needs its original add or cut operation.");
  }
  return { profile, guide, originalTip, relief, fraction, pilot, seatSketch };
}

/** Plan a flush turned stack against the actual refill-seat bore and the requested
 * radial wall. Lengths and assembly datums stay in place as paired threads resize. */
export function planSlimAttachments(project: Project, options: SlimAttachmentOptions) {
  const { coneId, barrelId, minimumWall: wall, boreDiameter: bore, requestedDiameter } = options;
  if (![wall, bore, requestedDiameter].every(n => Number.isFinite(n) && n > 0))
    throw Error("Enter positive barrel, bore and radial wall dimensions.");
  const values = resolveParameters(project.parameters);
  const root = project.features.find(f => f.id === coneId && !f.suppressed), sketch = project.sketches.find(s => s.id === root?.sketchId);
  if (!sketch) throw Error("Restore the screw-on cone before slimming the pen.");
  const seat = readSeat(project, coneId, sketch, values, wall), prefix = seat.profile.prefix;
  const joints: JointConfig = project.workspaces?.joints ?? {};
  const nosePair = threadPair(project, joints[coneId], barrelId, prefix, false);
  const cap = capForBarrel(project, barrelId, joints);
  if (cap) {
    if (evaluate(cap.amount, values, "angle") !== 360) throw Error("Restore the full revolution of the cap before slimming.");
    verifyCapMeridian(cap.sketch, values);
  }
  const recognized = new Set([nosePair.female.id, ...(cap?.pairs.map(p => p.male.id) ?? [])]);
  if (partFeatures(project, barrelId).some(f => !f.suppressed && f.finishes?.some(t =>
    !t.suppressed && t.kind === "thread" && !recognized.has(t.id))))
    throw Error("This barrel has an additional thread. Size its mating part and thread wall independently before slimming it.");
  const allowance = values[prefix + "_allowance"];
  if (seat.pilot && seat.pilot + 0.02 > bore) throw Error("The refill-seat pilot needs a barrel bore of at least " + mm(seat.pilot + 0.02) + " for that radial wall.");
  const lip = seat.guide + 2 * wall;
  const taper = 0.1;
  const optionsForCap = cap ? familySizes(cap.prefix, cap.pairs[0].female, values) : [];
  type Candidate = { cone: Size; cap?: Size; min: number; leastBase: number; baseLimit: number; reason: string };
  const candidates: Candidate[] = [];
  for (const n of familySizes(prefix, nosePair.female, values)) {
    // The front-loaded refill passes through the internal socket when the cone is removed.
    const socketPilot = threadMinorDiameter(n.diameter, n.pitch);
    const tenonRoot = threadMinorDiameter(n.diameter - allowance, n.pitch);
    if (!allowable(n, allowance, values[prefix + "_thread_length"]) || socketPilot < bore - eps ||
      tenonRoot < Math.max(seat.guide + 2 * wall, seat.relief + 2 * wall, seat.pilot + (seat.pilot ? 0.02 : 0)) - eps) continue;
    const leastBase = Math.max(lip + taper, n.diameter + 2 * wall, seat.relief ? seat.relief + 2 * wall + (1 - seat.fraction) * taper : 0);
    if (!cap) {
      candidates.push({ cone: n, min: leastBase, leastBase, baseLimit: Infinity, reason: threadLabel(n) + " cone socket, shoulder and writing-guide wall" });
      continue;
    }
    const capAllowance = values[cap.prefix + "_allowance"];
    for (const c of optionsForCap) {
      const capMinor = threadMinorDiameter(c.diameter, c.pitch);
      // The front barrel carries both an inside cone thread and an outside cap thread.
      const barrelRoot = threadMinorDiameter(c.diameter - capAllowance, c.pitch);
      if (!allowable(c, capAllowance, values[cap.prefix + "_thread_length"]) || barrelRoot < n.diameter + 2 * wall - eps ||
        capMinor < leastBase + clearOverCone - eps) continue;
      candidates.push({
        cone: n, cap: c, min: c.diameter + 2 * wall, leastBase, baseLimit: capMinor - clearOverCone,
        reason: threadLabel(c) + " cap socket over the " + threadLabel(n) + " cone thread, with " + mm(wall) + " radial wall"
      });
    }
  }
  if (!candidates.length) throw Error("The available thread sizes cannot preserve the cone bore, barrel socket and selected radial wall. Reduce the wall or redesign the paired threads.");
  const minimumDiameter = Math.ceil((Math.min(...candidates.map(c => c.min)) - 1e-9) * 1e6) / 1e6;
  const appliedDiameter = Math.max(requestedDiameter, minimumDiameter);
  const chosen = candidates.find(c => c.min <= appliedDiameter + eps)!;
  const originalBase = values[seat.profile.base!];
  const base = cap ? Math.max(chosen.leastBase, Math.min(originalBase, chosen.baseLimit)) : appliedDiameter;
  const minTip = seat.relief && seat.fraction < 1 - eps ? Math.max(lip,
    (seat.relief + 2 * wall - seat.fraction * base) / (1 - seat.fraction)) : lip;
  const tip = Math.max(minTip, Math.min(seat.originalTip, base - taper));
  const changes = new Map<string, string>(), labels = new Map<string, string>();
  const set = (key: string, n: number) => { if (Math.abs(values[key] - n) > 1e-8) changes.set(key, mm(n)); };
  const setThread = (prefix: string, size: Size, pairs: { male: Thread; female: Thread }[]) => {
    set(prefix + "_major", size.diameter); set(prefix + "_pitch", size.pitch);
    for (const p of pairs) { labels.set(p.male.id, size.label); labels.set(p.female.id, size.label); }
  };
  let driven = mm(appliedDiameter);
  if (options.diameterExpression) {
    try {
      if (Math.abs(evaluate(options.diameterExpression, values) - appliedDiameter) < eps) driven = options.diameterExpression;
    } catch { /* A new barrel driver may only exist after the barrel resize. */ }
  }
  setThread(prefix, chosen.cone, [nosePair]);
  changes.set(seat.profile.base!, cap ? mm(base) : driven);
  set(seat.profile.tip!, tip);
  if (cap && chosen.cap) {
    setThread(cap.prefix, chosen.cap, cap.pairs);
    changes.set(cap.prefix + "_diameter", driven);
    const roof = values[cap.prefix + "_wall"];
    const crown = cap.profile.crown === "flat" ? 0 : values[cap.prefix + "_crown"];
    const newCrown = cap.profile.crown === "domed" ? Math.min(crown, appliedDiameter / 2) : crown;
    if (newCrown !== crown) set(cap.prefix + "_crown", newCrown);
    if (roof < wall) {
      set(cap.prefix + "_wall", wall);
      // Keep the original interior depth even when the selected roof gets thicker.
      const increase = Math.max(0, wall - roof + newCrown - crown);
      if (increase) set(cap.prefix + "_length", values[cap.prefix + "_length"] + increase);
    }
  }
  const next: Project = {
    ...project, parameters: project.parameters.map(p => changes.has(p.name) ? { ...p, expression: changes.get(p.name)! } : p),
    features: project.features.map(f => f.finishes?.some(t => labels.has(t.id)) ? {
      ...f, finishes: f.finishes.map(t =>
        t.kind === "thread" && labels.has(t.id) ? { ...t, preset: labels.get(t.id)! } : t)
    } : f)
  };
  if (seat.pilot && seat.seatSketch) {
    const stock = seat.seatSketch, actual = 2 * evaluate(stock.points[1].y, values);
    if (seat.pilot > actual + eps) next.sketches = project.sketches.map(s => s !== stock ? s : {
      ...s,
      points: s.points.map((p, i) => i === 1 || i === 2 ? { ...p, y: "(" + stock.points[0].y + ") + " + mm(wall) } : p)
    });
  }
  // A retained user formula can depend on another driver we just changed. Re-read
  // all dimensions used by the wall calculation before reporting its result.
  const actual = resolveParameters(next.parameters);
  const expected = new Map<string, number>([[seat.profile.opening, seat.guide], [seat.profile.tip!, tip], [seat.profile.base!, base]]);
  for (const [p, size] of [[prefix, chosen.cone], ...(cap && chosen.cap ? [[cap.prefix, chosen.cap] as const] : [])] as const) {
    expected.set(p + "_major", size.diameter);
    expected.set(p + "_pitch", size.pitch);
    for (const key of ["allowance", "thread_length"]) expected.set(p + "_" + key, values[p + "_" + key]);
  }
  expected.set(seat.profile.length!, values[seat.profile.length!]);
  if (cap) {
    for (const k of ["length", ...(cap.profile.crown === "flat" ? [] : ["crown"])]) {
      const field = cap.prefix + "_" + k;
      expected.set(field, changes.has(field) ? evaluate(changes.get(field)!, values) : values[field]);
    }
    validateCapProfile(cap.profile, actual);
    verifyCapMeridian(cap.sketch, actual);
    expected.set(cap.prefix + "_wall", Math.max(wall, values[cap.prefix + "_wall"]));
    expected.set(cap.prefix + "_diameter", appliedDiameter);
  }
  for (const [name, wanted] of expected) {
    if (Math.abs(actual[name] - wanted) > eps)
      throw Error("The formula for " + name + " changes with the selected thread. Give that dimension an independent value before slimming.");
  }
  return {
    project: next, minimumDiameter, appliedDiameter, coneThread: threadLabel(chosen.cone), capThreads: chosen.cap ? [threadLabel(chosen.cap)] : [],
    limitingReason: candidates.find(c => Math.abs(c.min - minimumDiameter) < eps)!.reason
  };
}
