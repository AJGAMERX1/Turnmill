import { evaluate, resolveParameters } from "./expressions";
import { threadMinorDiameter, threadPresets, type Finish } from "./finishingTypes";
import type { FitSurface } from "./fitSurfaces";
import { validateCapProfile } from "./capProfile";
import { turningReferences } from "./turningReferences";
import { defaultJoint, type Joint } from "./kinematics";
import { partFeatures } from "./partTabs";
import { uid } from "./projects";
import { isSleeveDonor, refillComponents } from "./refills";
import type { Feature, Project, Sketch } from "./types";

type End = "start" | "end";
export type BarrelEnd = { axis: "X" | "Z"; centerline: [number, number, number]; station: number; outside: number; bore: number;
  bandSurfaces?: FitSurface[]; end?: End };
export type PairSettings = {
  end: End; size: string; length: string; coneLength: string; tipDiameter: string;
  opening: string; allowance: string; mode: "modeled" | "cosmetic"; backWall?: string;
};

export function barrelAxis(root: Feature | undefined, surfaces: FitSurface[] = []): "X" | "Z" {
  if (root?.kind === "revolve") return "X";
  if (root?.kind !== "import") return "Z";
  const sides = surfaces.filter(s => s.side === "shaft" && (Math.abs(s.axis[0]) > 0.999999 || Math.abs(s.axis[2]) > 0.999999));
  const area = (s: FitSurface) => Math.abs(s.end - s.start) * (s.diameter + (s.endDiameter ?? s.diameter));
  const largest = sides.reduce<FitSurface | undefined>((best, s) => !best || area(s) > area(best) ? s : best, undefined);
  return largest && Math.abs(largest.axis[0]) > 0.999999 ? "X" : "Z";
}

// Fit surfaces are measured from the finished body in its own coordinate frame.
export function barrelEnd(surfaces: FitSurface[], axis: "X" | "Z", end: End): BarrelEnd | undefined {
  const coordinate = axis === "X" ? 0 : 2;
  const aligned = surfaces.filter(s => Math.abs(s.axis[coordinate]) > 1 - 1e-6).map(s => {
    // Taper stations may be measured along a negative B-rep axis.
    if (s.axis[coordinate] > 0) return s;
    return { ...s, start: -s.end, end: -s.start, diameter: s.endDiameter ?? s.diameter, endDiameter: s.diameter };
  });
  const outside = aligned.filter(s => s.side === "shaft");
  if (!outside.length) return;
  const bounds = axis === "X" ? aligned.find(s => s.turnedBounds)?.turnedBounds : undefined;
  const station = bounds ? bounds[end === "start" ? 0 : 1]
    : end === "start" ? Math.min(...outside.map(s => s.start)) : Math.max(...outside.map(s => s.end));
  const atEnd = aligned.filter(s => Math.abs(s[end] - station) < 1e-5);
  const diam = (s: FitSurface) => end === "end" ? s.endDiameter ?? s.diameter : s.diameter;
  const outer = atEnd.filter(s => s.side === "shaft").sort((a, b) => diam(b) - diam(a))[0];
  if (!outer) return;
  const concentric = atEnd.filter(s => s.side === "bore" &&
    s.centerline.every((n, i) => Math.abs(n - outer.centerline[i]) < 1e-5));
  const bandSurfaces = aligned.filter(s => s.centerline.every((n, i) => Math.abs(n - outer.centerline[i]) < 1e-5));
  const rim = { axis, centerline: outer.centerline, station, outside: diam(outer), bore: Math.max(0, ...concentric.map(diam)), bandSurfaces, end };
  return usableRim(rim) ? rim : undefined;
}

const tolerance = 1e-6;
const presets = threadPresets.map(preset => ({
  ...preset, major: evaluate(preset.diameter, {}), step: evaluate(preset.pitch, {}),
}));

function usableRim(rim: BarrelEnd | undefined) {
  return !!rim && Number.isFinite(rim.outside) && Number.isFinite(rim.bore) && rim.bore >= 0 && rim.outside > rim.bore + tolerance;
}

function checkBarrel(project: Project, bodyId: string, ...rims: BarrelEnd[]) {
  if (refillComponents(project).some(refill => refill.bodyId === bodyId))
    throw Error("Select the pen barrel to add screw-on parts. The refill fits inside it.");
  if (!rims.every(usableRim))
    throw Error("The thread needs a flat, round end with material around its center. Select a barrel or change the pointed end to a flat shoulder.");
}

export type CapConeFit = { bodyId: string; parameter: string; from: number; to: number; name: string };
type Clearance = { name: string; diameter: number; cone?: { bodyId: string; parameter: string; minimum: number } };

/** Internal seat geometry can leave the original cone OD available for a cap.
 * Verify the measured meridian before permitting a base-diameter adjustment.
 * A relief cut through the taper still needs its specified 0.3 mm diametral wall. */
function seatBaseLimit(project: Project, root: Feature, sketch: Sketch,
  male: Extract<Finish, { kind: "thread" }>, values: Record<string, number>) {
  const extra = partFeatures(project, root.id).filter(f => !f.suppressed && f !== root);
  if (!extra.length) return 0;
  const setup = project.workspaces?.writingSetups?.[root.id];
  const seat = extra[0];
  if (extra.length !== 1 || setup?.coneId !== root.id || setup.seatFeatureId !== seat.id ||
      !seat.writingSeat || seat.bodyId !== root.id || seat.kind !== "revolve" || seat.advanced ||
      seat.finishes?.length || seat.operations?.length || evaluate(seat.amount, values, "angle") !== 360) return;
  const profile = project.sketches.find(s => s.id === seat.sketchId);
  if (profile?.partId !== root.id || profile.constraints.length || profile.points.length !== 4) return;
  const [a,b,c,d] = profile.points;
  if (a.x !== b.x || c.x !== d.x || a.y !== d.y || b.y !== c.y) return;
  const base = evaluate(sketch.points[0].x, values), tip = evaluate(sketch.points[2].x, values);
  const length = Math.abs(base - tip), inward = Math.sign(base - tip);
  const rear = length + evaluate(male.length, values);
  const depth = (x: string) => (evaluate(x, values) - tip) * inward;
  const stop = depth(d.x), inner = 2 * evaluate(a.y, values), outer = 2 * evaluate(b.y, values);
  const minor = threadMinorDiameter(evaluate(male.diameter, values), evaluate(male.pitch, values));
  if (Math.abs(depth(a.x) - rear) > tolerance || inner < 0 || outer <= inner || outer >= minor) return;
  if (seat.operation === "add" && stop > rear && inner > 0) return 0;
  if (seat.operation !== "cut" || inner !== 0 || stop <= tolerance || stop >= rear) return;
  if (stop >= length) return 0;
  const tipDiameter = 2 * evaluate(sketch.points[2].y, values);
  return tipDiameter + (outer + 0.3 - tipDiameter) * length / stop;
}

/** Keep screw mates on the barrel stock when only an integral refill stop follows.
 * Other machining keeps its existing position in history. */
function barrelThreadTarget(history: Feature[]) {
  const last = history.at(-1), prior = history.at(-2);
  if (last?.refillBacking && !last.finishes?.length && !last.advanced && !last.operations?.length &&
      prior && !prior.advanced && !prior.operations?.length) return prior;
  return last;
}

function attachedClearance(project: Project, host: string, values: Record<string, number>): Clearance | undefined {
  const joints = (project.workspaces?.joints ?? {}) as Record<string, Joint>;
  const refills = refillComponents(project);
  let largest: Clearance | undefined;
  for (const [id, joint] of Object.entries(joints)) {
    if (joint.parent !== host) continue;
    const f = project.features.find(f => f.id === id && !f.suppressed);
    if (!f) continue;
    let diameter = 0;
    let cone: Clearance["cone"];
    if (joint.refillSnap) {
      const refill = refills.find(r => r.bodyId === id && isSleeveDonor(r.kind));
      if (refill) diameter = values[refill.prefix + "_collar_diameter"];
    } else if (joint.threadMate && f.kind === "revolve" && !f.advanced && !f.operations?.length) {
      // The paired nose generator puts the driving base radius at its second vertex.
      // A subsequently modified solid needs the kernel's exact clearance check.
      const sketch = project.sketches.find(s => s.id === f.sketchId);
      const male = f.finishes?.find(t => t.id === joint.threadMate!.moving.finishId && !t.suppressed);
      if (male?.kind === "thread" && male.preparation === "tenon" && f.finishes?.length === 1 &&
          sketch?.points.length === 4 && sketch.constraints.length === 0 && /^cone\d*_base \/ 2$/.test(sketch.points[1].y)) {
        const wallLimit = seatBaseLimit(project, f, sketch, male, values);
        if (wallLimit === undefined) continue;
        diameter = 2 * evaluate(sketch.points[1].y, values);
        const parameter = sketch.points[1].y.split(" ")[0], prefix = parameter.slice(0, -5);
        const [a, b, c, d] = sketch.points;
        const mate = joint.threadMate.mating;
        const socket = partFeatures(project, host).find(step => !step.suppressed && step.id === mate.featureId)?.finishes
          ?.find(t => !t.suppressed && t.id === mate.finishId);
        if (socket?.kind === "thread" && socket.preparation === "socket" && socket.side === "internal" &&
            joint.threadMate.moving.featureId === id && male.side === "external" && f.operation === "new" &&
            sketch.partId === id && !sketch.capProfile && !sketch.coneEdge && evaluate(f.amount, values, "angle") === 360 &&
            a.y === prefix + "_opening / 2" && d.y === a.y && c.y === prefix + "_tip / 2" &&
            a.x === b.x && c.x === d.x && c.x === a.x + (socket.end === "end" ? " + " : " - ") + prefix + "_length") {
          const minimum = Math.max(wallLimit, Math.max(evaluate(male.diameter, values), evaluate(socket.diameter, values),
            values[prefix + "_tip"]) + 0.3);
          cone = { bodyId: id, parameter, minimum };
        }
      }
    }
    if (diameter > (largest?.diameter ?? 0)) largest = { diameter, name: f.name, cone };
  }
  return largest;
}

function diameterAt(s: FitSurface, x: number) {
  return s.diameter + (x - s.start) / (s.end - s.start) * ((s.endDiameter ?? s.diameter) - s.diameter);
}

/** Outside diameter on the barrel side of the seating plane, including shoulders on a step or taper. */
export function shoulderOutside(rim: BarrelEnd, length: number): number {
  if (!rim.end || !rim.bandSurfaces?.length || !(length > 0)) return rim.outside;
  const inward = rim.end === "start" ? 1 : -1, seat = rim.station + inward * length;
  const probe = seat + inward * tolerance;
  const lands = rim.bandSurfaces.filter(s => s.side === "shaft" && s.start < probe && probe < s.end);
  return lands.length ? Math.max(...lands.map(s => diameterAt(s, Math.max(s.start, Math.min(s.end, seat))))) : NaN;
}

function shoulderDriver(project: Project, bodyId: string, stock: BarrelEnd, end: End, length: number, values: Record<string, number>) {
  const shoulder = shoulderOutside(stock, length);
  if (!Number.isFinite(shoulder)) throw Error("Choose a thread length that ends on a measurable round shoulder.");
  const seat = stock.station + (end === "start" ? length : -length);
  const probe = seat + (end === "start" ? tolerance : -tolerance);
  const continuousLand = stock.bandSurfaces?.some(s => s.side === "shaft" &&
    Math.abs(s.diameter - stock.outside) < tolerance && Math.abs((s.endDiameter ?? s.diameter) - stock.outside) < tolerance &&
    s.start < probe && s.end > probe && s.start <= stock.station + tolerance && s.end >= stock.station - tolerance);
  if (continuousLand && Math.abs(shoulder - stock.outside) < tolerance) {
    const refs = turningReferences(project, bodyId, stock, end, values, probe);
    if (refs.diameter) return refs.diameter;
  }
  return Number(shoulder.toFixed(7)) + " mm";
}

/** Limit the thread to material actually present along its engagement. Intersected
 * lands and cones describe the turned envelope; the kernel checks interrupted faces. */
function bandDimensions(rim: BarrelEnd, length: number) {
  let outside = rim.outside, bore = rim.bore;
  if (!rim.bandSurfaces || !rim.end) return { outside, bore };
  const other = rim.station + (rim.end === "start" ? length : -length);
  const lo = Math.min(rim.station, other), hi = Math.max(rim.station, other);
  for (const s of rim.bandSurfaces) {
    const a = Math.max(lo, s.start), b = Math.min(hi, s.end);
    if (b <= a + tolerance) continue;
    if (s.side === "shaft") outside = Math.min(outside, diameterAt(s, a), diameterAt(s, b));
    else bore = Math.max(bore, diameterAt(s, a), diameterAt(s, b));
  }
  return { outside, bore };
}

function capLimits(project: Project, bodyId: string, stock: BarrelEnd, rear: BarrelEnd | undefined, length: number) {
  const values = resolveParameters(project.parameters);
  const rims = [stock, ...(rear ? [rear] : [])];
  const bands = rims.map(r => bandDimensions(r, length));
  let bore = Math.max(...bands.map(b => b.bore));
  // The measured bore at a threaded mouth is its minor diameter. The external
  // thread root must also leave material over the internal thread's groove.
  for (const f of partFeatures(project, bodyId)) {
    for (const t of f.finishes ?? []) {
      if (f.suppressed || t.suppressed || t.kind !== "thread" || t.side !== "internal" ||
          (t.preparationAxis && t.preparationAxis !== stock.axis) || (rims.length === 1 && stock.end && t.end !== stock.end)) continue;
      bore = Math.max(bore, evaluate(t.diameter, values));
    }
  }
  return { outside: Math.min(...bands.map(b => b.outside)), bore, attachment: attachedClearance(project, bodyId, values) };
}

function sizeProblem(major: number, pitch: number, allowance: number, outside: number, bore: number,
  kind: "cap" | "cone", attachment?: Clearance): string | undefined {
  if (!Number.isFinite(allowance) || allowance < 0 || allowance >= major - threadMinorDiameter(major, pitch))
    return "Reduce the diametral allowance so the thread flanks still engage.";
  if (kind === "cone") {
    if (major >= outside) return "Choose a smaller thread to leave material around the barrel socket.";
    if (threadMinorDiameter(major, pitch) < bore - tolerance)
      return "The existing bore is larger than this thread’s pilot. Choose a larger thread or a finer pitch.";
  } else {
    if (major - allowance >= outside - tolerance)
      return "Choose a smaller thread that can be cut inside both original barrel ends.";
    if (threadMinorDiameter(major - allowance, pitch) <= bore + 0.02 + tolerance)
      return "The thread root would cut into the barrel bore or its internal thread. Choose a larger thread or a finer pitch.";
    if (attachment && threadMinorDiameter(major, pitch) <= attachment.diameter + tolerance)
      return "The cap opening must pass over " + attachment.name + " (Ø" + Number(attachment.diameter.toFixed(3)) + " mm). Choose a wider opening or narrow that part.";
  }
}

/** List sizes that fit the measured rims, with the default at the front. Full axial stock and other parts are checked by the kernel. */
export function compatiblePairSizes(project: Project, bodyId: string, stock: BarrelEnd, kind: "cap" | "cone",
  rear?: BarrelEnd, allowance = 0.1, length = 4.5): string[] {
  if (!usableRim(stock) || (kind === "cap" && !usableRim(rear)) || !Number.isFinite(length) || length <= 0 ||
      refillComponents(project).some(refill => refill.bodyId === bodyId)) return [];
  const { outside, bore, attachment } = kind === "cap" ? capLimits(project, bodyId, stock, rear, length) : { ...stock, attachment: undefined };
  const shoulders = kind === "cap" ? [shoulderOutside(stock, length), shoulderOutside(rear!, length)] : [];
  const score = (p: typeof presets[number]) => Math.abs(p.major - 0.8 * outside) + Math.abs(p.step - 0.75) / 4;
  return presets.filter(p => !sizeProblem(p.major, p.step, allowance, outside, bore, kind, attachment) &&
    (kind === "cone" || shoulders.every(od => p.major - allowance < od - tolerance)))
    .sort((a,b) => Number(b.label.startsWith("M")) - Number(a.label.startsWith("M")) || score(a) - score(b))
    .map(p => p.label);
}

type AxialRange = [number, number];

// Express each measured face in millimetres inward from the mouth of this end.
function facesByDepth(rim: BarrelEnd) {
  const start = rim.end === "start";
  return (rim.bandSurfaces ?? []).map(s => ({
    side: s.side,
    lo: start ? s.start - rim.station : rim.station - s.end,
    hi: start ? s.end - rim.station : rim.station - s.start,
    first: start ? s.diameter : s.endDiameter ?? s.diameter,
    last: start ? s.endDiameter ?? s.diameter : s.diameter,
  })).filter(s => s.hi > 0 && s.hi > s.lo).sort((a, b) => a.lo - b.lo);
}

/** Depth ranges where a thread fits the measured band and its shoulder has a
 * complete turned surface beyond the stop. Clip tapered faces at the actual
 * diameter crossing so narrow usable lands survive independently of grid size. */
function seatRanges(faces: ReturnType<typeof facesByDepth>, male: number, pitch: number, limit: number, matchCap?: number, originalOD?: number) {
  const root = threadMinorDiameter(male, pitch);
  const stopWidth = Math.min(pitch / 20, 0.05);
  const stopDiameter = Math.max(male + Math.min(root / 10, 0.02) + tolerance, matchCap ?? 0);
  const intervals: AxialRange[] = [];
  for (const face of faces) {
    if (face.lo > limit) break;
    const { lo, hi, first, last } = face;
    const crossing = (d: number) => lo + (hi - lo) * (d - first) / (last - first);
    const shaft = face.side === "shaft";
    const threshold = shaft ? male + tolerance : root - 0.02 - tolerance;
    const firstMargin = shaft ? first - threshold : threshold - first;
    const lastMargin = shaft ? last - threshold : threshold - last;
    // Once the thread would cut through a bore or run out of stock, a land
    // farther in cannot restore that material along the preceding engagement.
    if (firstMargin <= 0) limit = Math.min(limit, Math.max(0, lo));
    else if (lastMargin <= 0) limit = Math.min(limit, crossing(threshold) - tolerance);
    if (!shaft || Math.max(first, last) <= stopDiameter) continue;
    if (originalOD !== undefined && (Math.abs(first - originalOD) > tolerance || Math.abs(last - originalOD) > tolerance)) continue;
    const from = Math.max(0, first <= stopDiameter ? crossing(stopDiameter) + tolerance : lo);
    const to = last <= stopDiameter ? crossing(stopDiameter) - tolerance : hi;
    if (to > from) intervals.push([from, to]);
  }
  const lands: AxialRange[] = [];
  for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0])) {
    const prev = lands.at(-1);
    if (prev && lo <= prev[1] + tolerance) prev[1] = Math.max(prev[1], hi);
    else lands.push([lo, hi]);
  }
  return lands.map(([lo, hi]): AxialRange => [Math.max(pitch, lo), Math.min(limit, hi - stopWidth)])
    .filter(([lo, hi]) => hi >= lo);
}

/** Recommend the closest common seating depth on measured stock. A custom cap
 * diameter is honored; otherwise the cap mouth follows the front shoulder.
 * Exact cuts and front/back assembly clearance still run before committing. */
export function recommendCapSeat(project: Project, bodyId: string, front: BarrelEnd, rear: BarrelEnd,
  requestedLength: number, allowance = 0.1, capOutside?: number, preferOriginal = false): { length: number; size: string } | undefined {
  if (!(Number.isFinite(requestedLength) && requestedLength > 0 && Number.isFinite(allowance) && allowance >= 0) ||
      (capOutside !== undefined && !(Number.isFinite(capOutside) && capOutside > 0)) ||
      !usableRim(front) || !usableRim(rear) || front.axis !== rear.axis || !front.end || !rear.end || front.end === rear.end ||
      refillComponents(project).some(r => r.bodyId === bodyId)) return;
  const span = Math.abs(front.station - rear.station);
  const limit = (span - 2 * tolerance) / 2;
  const frontFaces = facesByDepth(front), rearFaces = facesByDepth(rear);
  const { outside, bore, attachment } = capLimits(project, bodyId, front, rear, 0);
  function choose(originalOD?: number) {
    let best: number | undefined;
    const sizes = new Set<string>();
    // Each standard thread costs one scan of the faces at each end, regardless
    // of how long the barrel is or how narrow a gap needs to be crossed.
    for (const p of presets) {
      if (p.step > limit || (capOutside !== undefined && capOutside <= p.major + 1e-5) ||
          sizeProblem(p.major, p.step, allowance, outside, bore, "cap", attachment)) continue;
      const male = p.major - allowance;
      const a = seatRanges(frontFaces, male, p.step, limit, capOutside === undefined ? p.major + 1e-5 : undefined, originalOD);
      const b = seatRanges(rearFaces, male, p.step, limit, undefined, originalOD);
      for (let i = 0, j = 0; i < a.length && j < b.length;) {
        const lo = Math.max(a[i][0], b[j][0]), hi = Math.min(a[i][1], b[j][1]);
        if (lo <= hi) {
          let length = requestedLength;
          if (length < lo || length > hi) {
            // Prefer a simple shop dimension, using tenths for narrower lands.
            const grid = Math.ceil(lo * 4) <= Math.floor(hi * 4) ? 4 : 10;
            const from = Math.ceil(lo * grid) / grid, to = Math.floor(hi * grid) / grid;
            length = from <= to ? Math.max(from, Math.min(to, length)) : Number(((lo + hi) / 2).toFixed(6));
          }
          if (length >= lo && length <= hi) {
            const distance = Math.abs(length - requestedLength);
            if (best === undefined || distance < Math.abs(best - requestedLength) - tolerance ||
                (Math.abs(distance - Math.abs(best - requestedLength)) <= tolerance && length < best)) {
              best = length;
              sizes.clear();
            }
            if (length === best) sizes.add(p.label);
          }
        }
        if (a[i][1] < b[j][1]) i++;
        else j++;
      }
    }
    if (best === undefined) return;
    const size = compatiblePairSizes(project, bodyId, front, "cap", rear, allowance, best).find(label => sizes.has(label));
    if (size) return { length: best, size };
  }
  const nearest = choose();
  if (!nearest || (nearest.length === requestedLength && !preferOriginal) || capOutside !== undefined ||
      Math.abs(front.outside - rear.outside) > tolerance) return nearest;
  return choose(front.outside) ?? nearest;
}

function adjustedDriver(expression: string, before: number, after: number, nominal: string, values: Record<string, number>) {
  // A user can link either dimension to another named parameter. Preserve that link when refitting.
  const dependsOnParameter = expression.match(/[a-zA-Z_]\w*/g)?.some(name => Object.hasOwn(values, name));
  if (!dependsOnParameter) return nominal;
  const sign = after < before ? " - " : " + ";
  return "(" + expression + ")" + sign + Number(Math.abs(after - before).toFixed(12)) + " mm";
}

/** Only change the generated cone's private base driver. Preserve its original
 * parameter dependency when the proposal is accepted in the draft. */
export function applyCapConeFit(project: Project, fit: CapConeFit): Project {
  const values = resolveParameters(project.parameters);
  if (!Number.isFinite(fit.to) || fit.to <= 0 || !(fit.to < fit.from) ||
      !Number.isFinite(values[fit.parameter]) || Math.abs(values[fit.parameter] - fit.from) > tolerance)
    throw Error("The cone diameter changed. Reopen Threads to measure a new fit.");
  return { ...project, parameters: project.parameters.map(p => p.name === fit.parameter
    ? { ...p, expression: adjustedDriver(p.expression, fit.from, fit.to, fit.to + " mm", values) } : p) };
}

export function suggestCapFit(project: Project, bodyId: string, front: BarrelEnd, rear: BarrelEnd,
  length: number, allowance = 0.1, capOutside?: number): { length: number; size: string; cone?: CapConeFit } | undefined {
  const direct = recommendCapSeat(project, bodyId, front, rear, length, allowance, capOutside);
  if (direct) return direct;
  const obstacle = attachedClearance(project, bodyId, resolveParameters(project.parameters));
  if (!obstacle?.cone) return;
  const { bodyId: coneBodyId, minimum, parameter } = obstacle.cone;
  const from = obstacle.diameter, name = obstacle.name;
  // A user may have reused the cone base in another part or assembly driver.
  // Limit this automatic offer to the generator's own lone profile reference.
  const token = new RegExp("\\b" + parameter + "\\b");
  const otherProfiles = project.sketches.filter(s => s.points[1]?.y !== parameter + " / 2");
  const ownProfileCount = project.sketches.length - otherProfiles.length;
  if (ownProfileCount !== 1 || project.parameters.some(p => token.test(p.expression)) ||
      token.test(JSON.stringify(otherProfiles)) || token.test(JSON.stringify(project.features)) ||
      token.test(JSON.stringify(project.workspaces ?? {}))) return;
  // Reserve 0.2 mm diametral clearance at the cap's narrowest threaded opening.
  // The trial checks all remaining attachments and both ends of the same barrel.
  const clearance = 0.2;
  if (!(minimum + clearance < from)) return;
  const trial = applyCapConeFit(project, { bodyId: coneBodyId, parameter, from, to: minimum + clearance, name });
  const proposed = recommendCapSeat(trial, bodyId, front, rear, length, allowance, capOutside, true);
  const preset = presets.find(p => p.label === proposed?.size);
  if (!proposed || !preset) return;
  const upper = threadMinorDiameter(preset.major, preset.step) - clearance;
  const to = Math.max(Number(minimum.toFixed(6)), Math.floor(upper * 10) / 10);
  if (!(to < from && to <= upper)) return;
  return { ...proposed, cone: { bodyId: coneBodyId, parameter, from, to, name } };
}

export function capAttachmentIssue(project: Project, bodyId: string): string | undefined {
  const obstacle = attachedClearance(project, bodyId, resolveParameters(project.parameters));
  if (obstacle) return "The cap’s threaded opening has to pass over " + obstacle.name + " (Ø" +
    Number(obstacle.diameter.toFixed(3)) + " mm). Narrow that part or choose a barrel with room for a larger thread.";
}

export function createThreadedCone(project: Project, bodyId: string, stock: BarrelEnd, settings: PairSettings) {
  checkBarrel(project, bodyId, stock);
  const target = barrelThreadTarget(partFeatures(project, bodyId).filter(f => !f.suppressed));
  if (!target) throw Error("Restore the barrel before adding threads.");
  if (partFeatures(project, bodyId).some(f => !f.suppressed && f.finishes?.some(
    op => op.kind === "thread" && !op.suppressed && op.end === settings.end && op.preparation === "socket"
  ))) throw Error("This end already has a threaded socket. Edit its existing threads, or choose the other barrel end.");
  const preset = threadPresets.find(p => p.label === settings.size);
  if (!preset) throw Error("Choose a thread size for both parts.");
  const values = resolveParameters(project.parameters);
  const value = (s: string) => evaluate(s, values);
  const major = value(preset.diameter), pitch = value(preset.pitch);
  const clearance = value(settings.allowance), opening = value(settings.opening), tip = value(settings.tipDiameter);
  const problem = sizeProblem(major, pitch, clearance, stock.outside, stock.bore, "cone");
  if (problem) throw Error(problem);
  if (!(value(settings.length) > 0 && value(settings.coneLength) > 0))
    throw Error("Give the cone and its threads a positive length.");
  if (opening < 0 || tip <= opening || tip >= stock.outside || opening >= threadMinorDiameter(major - clearance, pitch))
    throw Error("Keep the tip opening smaller than both the tip outside diameter and the thread root. The cone tip must be narrower than the barrel.");
  if (settings.backWall !== undefined && !(value(settings.backWall) > 0)) throw Error("Enter a positive back wall thickness.");

  const body = uid(), sketchId = uid(), maleId = uid(), socketId = uid();
  const { prefix, name } = attachmentName(project, "cone");
  const refs = turningReferences(project, bodyId, stock, settings.end, values);
  const inputs = [
    ["major", "Thread major diameter", preset.diameter], ["pitch", "Thread pitch", preset.pitch],
    ["thread_length", "Thread length", settings.length], ["allowance", "Diametral allowance", settings.allowance],
    ["length", "Cone length", settings.coneLength], ["base", "Cone base diameter", refs.diameter ?? (String(stock.outside) + " mm")],
    ["tip", "Tip outside diameter", settings.tipDiameter], ["opening", "Tip opening diameter", settings.opening],
  ];
  if (settings.backWall !== undefined) inputs.push(["back_wall", "Back wall thickness", settings.backWall]);
  const ref = (field: string) => prefix + "_" + field;
  const parameters = [...project.parameters, ...inputs.map(([key, label, expression]) => ({ name: ref(key), label, expression }))];
  const shared = { kind: "thread", preset: preset.label, hand: "right", length: ref("thread_length"),
    pitch: ref("pitch"), mode: settings.mode } as const;
  const socket: Finish = { ...shared, id: socketId, name: "Threads · barrel socket", end: settings.end,
    side: "internal", preparation: "socket", preparationAxis: stock.axis, preparationCenter: stock.centerline, diameter: ref("major"),
    ...(settings.backWall === undefined ? {} : { backWall: ref("back_wall") }) };
  const male: Finish = { ...shared, id: maleId, name: "Threads · cone tenon", end: settings.end === "end" ? "start" : "end",
    side: "external", preparation: "tenon", preparationAxis: "X", diameter: ref("major") + " - " + ref("allowance") };
  // Turn the cone about X. A screw mate also aligns it with a Z-axis barrel in Assembly.
  const base = refs.station ?? (stock.station + " mm");
  const tipX = base + (settings.end === "end" ? " + " : " - ") + ref("length");
  const sketch: Sketch = { id: sketchId, partId: body, name: name + " profile", constraints: [], points: [
    { x: base, y: ref("opening") + " / 2" }, { x: base, y: ref("base") + " / 2" },
    { x: tipX, y: ref("tip") + " / 2" }, { x: tipX, y: ref("opening") + " / 2" },
  ] };
  const next = addThreadedAttachment(project, bodyId, target.id, sketch, parameters, name, settings.end, ref, socket, male);
  return { project: next, coneId: body };
}

function attachmentName(project: Project, type: "cone" | "cap") {
  let n = 1;
  for (;;) {
    const suffix = n === 1 ? "" : String(n);
    const prefix = type + suffix, name = "Screw-on " + type + (suffix ? " " + suffix : "");
    if (!project.parameters.some(p => p.name.startsWith(prefix + "_")) && !project.features.some(f => f.name === name))
      return { prefix, name };
    n++;
  }
}

function addThreadedAttachment(project: Project, bodyId: string, targetId: string, sketch: Sketch,
  parameters: Project["parameters"], name: string, end: End, ref: (field: string) => string,
  hostThread: Finish, attachmentThread: Finish): Project {
  const body = sketch.partId!;
  const feature: Feature = { id: body, name, kind: "revolve", operation: "new", amount: "360 deg",
    suppressed: false, sketchId: sketch.id, finishes: [attachmentThread] };
  const travel = "(" + ref("thread_length") + " / " + ref("pitch") + ") * 360 deg";
  const joint = { ...defaultJoint(), kind: "screw", parent: bodyId,
    min: end === "end" ? "0 deg" : "-(" + travel + ")",
    max: end === "end" ? travel : "0 deg", threadMate: {
      moving: { featureId: body, finishId: attachmentThread.id }, mating: { featureId: targetId, finishId: hostThread.id },
      placement: "entrances", engagement: ref("thread_length"), phase: "180 deg",
    } } as const;
  const ws = project.workspaces;
  return { ...project, parameters, sketches: [...project.sketches, sketch], features: [
    ...project.features.map(f => f.id === targetId ? { ...f, finishes: [...(f.finishes ?? []), hostThread] } : f), feature,
  ], workspaces: { ...ws, joints: { ...ws?.joints, [body]: joint },
    bodyMaterials: { ...ws?.bodyMaterials, [body]: ws?.bodyMaterials?.[bodyId] ?? ws?.material ?? "Brass" },
    ...(ws?.bodyDensities?.[bodyId] === undefined ? {} : { bodyDensities: { ...ws.bodyDensities, [body]: ws.bodyDensities[bodyId] } }),
  } };
}

export type CapSettings = Pick<PairSettings, "end" | "size" | "length" | "allowance" | "mode"> & {
  capLength: string;
  capDiameter: string;
  matchBarrel?: boolean;
  crown: "flat" | "domed" | "tapered";
  crownLength: string;
  wall: string;
};

export function hasCapAttachments(project: Project, bodyId: string): boolean {
  const joints = project.workspaces?.joints ?? {};
  const hasSeatedRefill = project.features.some(f => f.operation === "new" && !f.suppressed &&
    joints[f.id]?.refillSnap === true && joints[f.id]?.parent === bodyId);
  return hasSeatedRefill || partFeatures(project, bodyId).some(f => !f.suppressed && f.finishes?.some(
    t => t.kind === "thread" && !t.suppressed && t.side === "internal"));
}

export type CapMount = { barrelId: string; front: End; active: End; ends: Record<End, Joint> };

/** Keep a single cap body and a single active screw joint when posting the cap. */
export function setCapMount(project: Project, capId: string, end: End, pose: Record<string, number[]> = project.workspaces?.jointPose ?? {}): Project {
  const ws = project.workspaces;
  const mount: CapMount | undefined = ws?.capMounts?.[capId];
  if (!mount?.ends[end]) throw Error("This cap has no matching thread at that barrel end.");
  const joint = mount.ends[end], mate = joint.threadMate;
  const liveThread = (owner: string, ref: NonNullable<Joint["threadMate"]>["moving"]) => {
    const history = partFeatures(project, owner);
    return history.some(f => f.id === owner && !f.suppressed) &&
      history.some(f => !f.suppressed && f.id === ref.featureId &&
        f.finishes?.some(t => t.kind === "thread" && !t.suppressed && t.id === ref.finishId));
  };
  if (!mate || !liveThread(mount.barrelId, mate.mating) || !liveThread(capId, mate.moving))
    throw Error("Restore the cap and its matching barrel thread before mounting it here.");
  return { ...project, workspaces: { ...ws, capMounts: { ...ws?.capMounts, [capId]: { ...mount, active: end } },
    joints: { ...ws?.joints, [capId]: joint }, jointPose: { ...pose, [capId]: [0] } } };
}

export function createThreadedCap(project: Project, bodyId: string, stock: BarrelEnd, settings: CapSettings, otherStock?: BarrelEnd) {
  checkBarrel(project, bodyId, stock, ...(otherStock ? [otherStock] : []));
  const history = partFeatures(project, bodyId).filter(f => !f.suppressed);
  const target = barrelThreadTarget(history);
  if (!target) throw Error("Restore the barrel before adding a cap.");
  if (history.some(f => f.finishes?.some(op => op.kind === "thread" && !op.suppressed && op.side === "external" &&
      (otherStock !== undefined || op.end === settings.end))))
    throw Error("A barrel end already has an external thread. Edit the existing cap or choose a barrel with free outside lands.");
  const opposite: End = settings.end === "end" ? "start" : "end";
  if (otherStock && (otherStock.axis !== stock.axis ||
      (stock.station - otherStock.station) * (settings.end === "end" ? 1 : -1) <= 1e-6))
    throw Error("Choose two distinct round ends of the same barrel.");
  const preset = threadPresets.find(p => p.label === settings.size);
  if (!preset) throw Error("Choose a thread size for the barrel and cap.");
  const values = resolveParameters(project.parameters);
  const value = (s: string) => evaluate(s, values);
  const major = value(preset.diameter), pitch = value(preset.pitch), allowance = value(settings.allowance);
  const engagement = value(settings.length);
  if (!(engagement > 0)) throw Error("Give the cap threads a positive length.");
  const limits = capLimits(project, bodyId, stock, otherStock, engagement);
  const problem = sizeProblem(major, pitch, allowance, limits.outside, limits.bore, "cap", limits.attachment);
  if (problem) throw Error(problem);
  if (otherStock && 2 * engagement >= Math.abs(stock.station - otherStock.station) - tolerance)
    throw Error("The front and back threads need separate shoulders. Shorten their engagement or lengthen the barrel.");

  const capDiameter = settings.matchBarrel ? shoulderDriver(project, bodyId, stock, settings.end, engagement, values) : settings.capDiameter;
  const { name, prefix } = attachmentName(project, "cap");
  const ref = (field: string) => prefix + "_" + field;
  const inputs = [
    ["major", "Thread major diameter", preset.diameter], ["pitch", "Thread pitch", preset.pitch],
    ["thread_length", "Thread length", settings.length], ["allowance", "Diametral allowance", settings.allowance],
    ["length", "Cap length", settings.capLength], ["diameter", "Cap outside diameter", capDiameter],
    ["wall", "End wall thickness", settings.wall],
  ];
  if (settings.crown !== "flat") inputs.push(["crown", "Crown length", settings.crownLength]);
  const parameters = [...project.parameters, ...inputs.map(([key, label, expression]) => ({ name: ref(key), label, expression }))];
  const profile = { prefix, crown: settings.crown };
  validateCapProfile(profile, resolveParameters(parameters));
  const body = uid();
  const refs = turningReferences(project, bodyId, stock, settings.end, values);
  const endPlane = refs.station ?? stock.station + " mm";
  const base = "(" + endPlane + ")" + (settings.end === "end" ? " - " : " + ") + ref("thread_length");
  const axial = (distance: string) => "(" + base + ")" + (settings.end === "end" ? " + " : " - ") + "(" + distance + ")";
  const r = "(" + ref("diameter") + " / 2)";
  const crown = settings.crown === "flat" ? "0 mm" : ref("crown");
  const length = ref("length"), tip = axial(length);
  const pilotRadius = "(" + ref("major") + " - " + (5 * Math.sqrt(3) / 8) + " * " + ref("pitch") + ") / 2";
  const cavityEnd = axial(length + " - " + crown + " - " + ref("wall"));
  // The closed roof and internal cavity are part of the editable meridian. The
  // thread only cuts its specified engagement length at the open end.
  const sketch: Sketch = { id: uid(), partId: body, name: name + " profile", constraints: [], capProfile: profile,
    points: [{ x: base, y: pilotRadius }, { x: base, y: r }] };
  if (settings.crown === "flat") sketch.points.push({ x: tip, y: r });
  else {
    sketch.points.push({ x: axial(length + " - " + crown), y: r });
    if (settings.crown === "tapered") sketch.points.push({ x: tip, y: r + " / 2" });
    else {
      // A circular arc of radius (r² + h²)/(2h) gives an exact spherical crown on revolution.
      const radius = "(" + r + " * (" + r + " / " + crown + ") + " + crown + ") / 2";
      sketch.constraints.push({ id: uid(), type: "arc", indices: [2],
        value: settings.end === "end" ? radius : "-(" + radius + ")" });
    }
  }
  sketch.points.push({ x: tip, y: "0 mm" }, { x: cavityEnd, y: "0 mm" }, { x: cavityEnd, y: pilotRadius });
  const shared = { kind: "thread", preset: preset.label, hand: "right", length: ref("thread_length"),
    pitch: ref("pitch"), mode: settings.mode } as const;
  const male: Finish = { ...shared, id: uid(), name: "Threads · barrel " + settings.end, end: settings.end,
    preparation: "flush", preparationAxis: stock.axis, preparationCenter: stock.centerline,
    side: "external", diameter: ref("major") + " - " + ref("allowance") };
  const socket: Finish = { ...shared, id: uid(), name: "Threads · cap socket", end: settings.end === "end" ? "start" : "end",
    preparation: "socket", preparationAxis: "X", side: "internal", diameter: ref("major") };
  const next = addThreadedAttachment(project, bodyId, target.id, sketch, parameters, name, settings.end, ref, male, socket);
  if (otherStock) {
    const second: Finish = { ...male, id: uid(), end: opposite, name: "Threads · barrel " + opposite,
      preparationCenter: otherStock.centerline };
    next.features = next.features.map(f => f.id === target.id ? { ...f, finishes: [...(f.finishes ?? []), second] } : f);
    const initial = next.workspaces!.joints[body] as Joint;
    // Limits act in the moving cap's local frame. On the other end the mounted
    // cap itself turns over, so the same coordinate still unscrews outwards.
    // The helix is generated from the minimum station of each band. Turning the
    // cap over maps its first station to the final groove phase on the barrel.
    const phase = "-(" + ref("thread_length") + " / " + ref("pitch") + ") * 360 deg";
    const posted: Joint = { ...initial, threadMate: { ...initial.threadMate!, phase,
      mating: { featureId: target.id, finishId: second.id } } };
    const mount: CapMount = { barrelId: bodyId, front: settings.end, active: settings.end,
      ends: settings.end === "start" ? { start: initial, end: posted } : { start: posted, end: initial } };
    next.workspaces!.capMounts = { ...next.workspaces!.capMounts, [body]: mount };
  }
  return { project: next, capId: body };
}

type ThreadRef = NonNullable<Joint["threadMate"]>["moving"];
type ThreadFinish = Extract<Finish, { kind: "thread" }>;

function referencedThread(project: Project, ref: ThreadRef | undefined) {
  if (!ref) return;
  return project.features.find(f => f.id === ref.featureId && !f.suppressed)?.finishes
    ?.find((t): t is ThreadFinish => t.kind === "thread" && !t.suppressed && t.id === ref.finishId);
}

function legacyPair(project: Project, capId: string) {
  const mount: CapMount | undefined = project.workspaces?.capMounts?.[capId];
  if (!mount || (mount.front !== "start" && mount.front !== "end") || typeof mount.barrelId !== "string" ||
      mount.barrelId === capId) return;
  const start = mount.ends?.start, end = mount.ends?.end;
  if (!start?.threadMate?.mating || !end?.threadMate?.mating || !start.threadMate.moving || !end.threadMate.moving ||
      start.parent !== mount.barrelId || end.parent !== mount.barrelId) return;
  const cap = project.features.find(f => f.id === capId && f.operation === "new" && f.kind === "revolve" && !f.suppressed);
  const profile = cap && project.sketches.find(s => s.id === cap.sketchId)?.capProfile;
  if (!profile?.prefix) return;
  const socketRef = start.threadMate.moving, otherSocket = end.threadMate.moving;
  if (socketRef.featureId !== capId || otherSocket.featureId !== capId || socketRef.finishId !== otherSocket.finishId) return;
  const socket = referencedThread(project, socketRef);
  if (socket?.preparation !== "socket" || socket.side !== "internal" || socket.diameter !== profile.prefix + "_major") return;
  const males = [start.threadMate.mating, end.threadMate.mating];
  const host = partFeatures(project, mount.barrelId);
  if (!host.some(f => f.id === mount.barrelId && !f.suppressed)) return;
  if (!males.every((ref, i) => {
    const thread = referencedThread(project, ref);
    return host.some(f => f.id === ref.featureId) && thread?.preparation === "collar" && thread.side === "external" &&
      thread.end === (i === 0 ? "start" : "end");
  })) return;
  return { mount, profile, males, socketRef, socket };
}

/** Recognize saved generated collars through their mate references, including after a rename or posting. */
export function legacyCapForBarrel(project: Project, id: string): string | undefined {
  const mounts: Record<string, CapMount> = project.workspaces?.capMounts ?? {};
  return Object.keys(mounts).find(capId => (id === capId || id === mounts[capId]?.barrelId) && legacyPair(project, capId));
}

/** Model for measuring original stock with all other barrel features applied. */
export function legacyCapBarrelStock(project: Project, capId: string): Project {
  const pair = legacyPair(project, capId);
  if (!pair) throw Error("Select a cap with a pair of raised barrel collars.");
  return { ...project, features: partFeatures(project, pair.mount.barrelId).map(f => ({
    ...f, finishes: f.finishes?.filter(t => !pair.males.some(ref => ref.featureId === f.id && ref.finishId === t.id)),
  })) };
}

/** Convert the existing pair as one edit, retaining cap, threads, sketch, mates and active pose. */
export function repairCapDiameter(project: Project, capId: string, surfaces: FitSurface[], size?: string, matchOutside = true) {
  const pair = legacyPair(project, capId);
  if (!pair) throw Error("Select a cap with a pair of raised barrel collars.");
  const { mount, profile, males, socket, socketRef } = pair;
  const barrelId = mount.barrelId;
  const measured = surfaces.filter(s => s.bodyId === barrelId);
  const axis = barrelAxis(project.features.find(f => f.id === barrelId), measured);
  const front = barrelEnd(measured, axis, mount.front);
  const rear = barrelEnd(measured, axis, mount.front === "start" ? "end" : "start");
  if (!front || !rear) throw Error("Both original barrel ends need a measurable round face for a flush cap.");
  const values = resolveParameters(project.parameters);
  const key = (field: string) => profile.prefix + "_" + field;
  const length = values[key("thread_length")], allowance = values[key("allowance")];
  const oldMajor = values[key("major")], oldPitch = values[key("pitch")], oldSize = socket.preset;
  const outside = shoulderOutside(front, length);
  if (!Number.isFinite(outside) || !Number.isFinite(shoulderOutside(rear, length)))
    throw Error("Choose a thread length that ends on a measurable round shoulder at each end.");
  const capOutside = matchOutside ? outside : values[key("diameter")];
  const sizes = compatiblePairSizes(project, barrelId, front, "cap", rear, allowance, length);
  const sameFamily = (label: string) => label.startsWith("M") === oldSize.startsWith("M");
  const choices = presets.filter(p => sizes.includes(p.label) && p.major <= oldMajor + tolerance && p.major < capOutside - 1e-5)
    .sort((a,b) => Number(Math.abs(b.step-oldPitch) < tolerance) - Number(Math.abs(a.step-oldPitch) < tolerance) ||
      Number(sameFamily(b.label)) - Number(sameFamily(a.label)) || b.major-a.major || Math.abs(a.step-oldPitch)-Math.abs(b.step-oldPitch))
    .map(p => p.label);
  const chosen = presets.find(p => p.label === (size ?? choices[0]) && choices.includes(p.label));
  if (!chosen) throw Error(capAttachmentIssue(project, barrelId) ??
    "No standard thread fits inside both original barrel ends. Try a shorter engagement or a thicker barrel wall.");
  if (2 * length >= Math.abs(front.station - rear.station) - tolerance)
    throw Error("Shorten the cap thread so the front and back retain separate seating shoulders.");
  // The major and pitch select the thread standard. Leave equivalent expressions (especially a driven pitch)
  // intact. Other dimensions and the front/back joint definitions continue to reference the same parameters.
  const parameters = project.parameters.map(p => {
    if (p.name === key("major") && Math.abs(oldMajor - chosen.major) > tolerance)
      return { ...p, expression: adjustedDriver(p.expression, oldMajor, chosen.major, chosen.diameter, values) };
    if (p.name === key("pitch") && Math.abs(oldPitch - chosen.step) > tolerance)
      return { ...p, expression: adjustedDriver(p.expression, oldPitch, chosen.step, chosen.pitch, values) };
    if (matchOutside && p.name === key("diameter")) return { ...p, expression: shoulderDriver(project, barrelId, front, mount.front, length, values) };
    return p;
  });
  validateCapProfile(profile, resolveParameters(parameters));
  const features = project.features.map(f => {
    const host = males.filter(ref => ref.featureId === f.id);
    if (!host.length && socketRef.featureId !== f.id) return f;
    return { ...f, finishes: f.finishes?.map(t => {
      if (t.kind !== "thread") return t;
      if (host.some(ref => ref.finishId === t.id)) {
        const { collarStockDiameter: _stock, ...thread } = t;
        return { ...thread, preset: chosen.label, preparation: "flush" as const,
          name: t.name === "Threads · barrel " + t.end + " collar" ? "Threads · barrel " + t.end : t.name };
      }
      if (f.id === socketRef.featureId && t.id === socketRef.finishId) return { ...t, preset: chosen.label };
      return t;
    }) };
  });
  return { project: { ...project, features, parameters }, capId, size: chosen.label, oldSize, outside, choices };
}
