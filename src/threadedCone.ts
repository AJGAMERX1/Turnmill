import { evaluate, resolveParameters } from "./expressions";
import { threadMinorDiameter, threadPresets, type Finish } from "./finishingTypes";
import type { FitSurface } from "./fitSurfaces";
import { validateCapProfile } from "./capProfile";
import { turningReferences } from "./turningReferences";
import { defaultJoint, type Joint } from "./kinematics";
import { partFeatures } from "./partTabs";
import { uid } from "./projects";
import { refillComponents } from "./refills";
import type { Feature, Project, Sketch } from "./types";

type End = "start" | "end";
export type BarrelEnd = { axis: "X" | "Z"; centerline: [number, number, number]; station: number; outside: number; bore: number };
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
  const station = end === "start" ? Math.min(...outside.map(s => s.start)) : Math.max(...outside.map(s => s.end));
  const atEnd = aligned.filter(s => Math.abs(s[end] - station) < 1e-5);
  const diam = (s: FitSurface) => end === "end" ? s.endDiameter ?? s.diameter : s.diameter;
  const outer = atEnd.filter(s => s.side === "shaft").sort((a, b) => diam(b) - diam(a))[0];
  const concentric = atEnd.filter(s => s.side === "bore" &&
    s.centerline.every((n, i) => Math.abs(n - outer.centerline[i]) < 1e-5));
  const rim = { axis, centerline: outer.centerline, station, outside: diam(outer), bore: Math.max(0, ...concentric.map(diam)) };
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

function sizeProblem(major: number, pitch: number, allowance: number, outside: number, bore: number,
  kind: "cap" | "cone", collars: boolean): string | undefined {
  if (!Number.isFinite(allowance) || allowance < 0 || allowance >= major - threadMinorDiameter(major, pitch))
    return "Reduce the diametral allowance so the thread flanks still engage.";
  if (kind === "cone") {
    if (major >= outside) return "Choose a smaller thread to leave material around the barrel socket.";
    if (threadMinorDiameter(major, pitch) < bore - tolerance)
      return "The existing bore is larger than this thread’s pilot. Choose a larger thread or a finer pitch.";
  } else {
    const minor = threadMinorDiameter(major - allowance, pitch);
    if (collars && minor <= outside + tolerance)
      return "Use a larger cap thread so its root clears the barrel and leaves the original pen opening intact.";
    if (!collars && major - allowance > outside - tolerance)
      return "Choose a smaller thread to leave a shoulder for the cap against the barrel.";
    if (minor <= bore + tolerance)
      return "The thread root would cut into the barrel bore. Choose a larger thread, reduce the allowance, or use a finer pitch.";
  }
}

/** List sizes that fit the measured rims, with the default at the front. Full axial stock and other parts are checked by the kernel. */
export function compatiblePairSizes(project: Project, bodyId: string, stock: BarrelEnd, kind: "cap" | "cone",
  rear?: BarrelEnd, allowance = 0.1): string[] {
  if (!usableRim(stock) || (kind === "cap" && !usableRim(rear)) ||
      refillComponents(project).some(refill => refill.bodyId === bodyId)) return [];
  const collars = kind === "cap" && capNeedsCollars(project, bodyId);
  const outside = kind === "cap" && rear ? (collars ? Math.max : Math.min)(stock.outside, rear.outside) : stock.outside;
  const bore = kind === "cap" && rear ? Math.max(stock.bore, rear.bore) : stock.bore;
  const score = (p: typeof presets[number]) => collars ? p.major + p.step * 0.01
    : Math.abs(p.major - 0.8 * outside) + Math.abs(p.step - 0.75) / 4;
  return presets.filter(p => !sizeProblem(p.major, p.step, allowance, outside, bore, kind, collars))
    .sort((a,b) => Number(b.label.startsWith("M")) - Number(a.label.startsWith("M")) || score(a) - score(b))
    .map(p => p.label);
}

export function createThreadedCone(project: Project, bodyId: string, stock: BarrelEnd, settings: PairSettings) {
  checkBarrel(project, bodyId, stock);
  const target = partFeatures(project, bodyId).filter(f => !f.suppressed).at(-1);
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
  const problem = sizeProblem(major, pitch, clearance, stock.outside, stock.bore, "cone", false);
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
  crown: "flat" | "domed" | "tapered";
  crownLength: string;
  wall: string;
};

export function capNeedsCollars(project: Project, bodyId: string): boolean {
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
  const target = history.at(-1);
  if (!target) throw Error("Restore the barrel before adding a cap.");
  if (history.some(f => f.finishes?.some(op => op.kind === "thread" && !op.suppressed && op.side === "external" &&
      (otherStock !== undefined || op.end === settings.end))))
    throw Error("A barrel end already has an external thread. Edit the existing cap or choose a barrel with free outside lands.");
  const collars = capNeedsCollars(project, bodyId);
  const opposite: End = settings.end === "end" ? "start" : "end";
  if (otherStock && (otherStock.axis !== stock.axis ||
      (stock.station - otherStock.station) * (settings.end === "end" ? 1 : -1) <= 1e-6))
    throw Error("Choose two distinct round ends of the same barrel.");
  const preset = threadPresets.find(p => p.label === settings.size);
  if (!preset) throw Error("Choose a thread size for the barrel and cap.");
  const values = resolveParameters(project.parameters);
  const value = (s: string) => evaluate(s, values);
  const major = value(preset.diameter), pitch = value(preset.pitch), allowance = value(settings.allowance);
  const outside = (collars ? Math.max : Math.min)(stock.outside, otherStock?.outside ?? stock.outside);
  const problem = sizeProblem(major, pitch, allowance, outside, Math.max(stock.bore, otherStock?.bore ?? stock.bore), "cap", collars);
  if (problem) throw Error(problem);
  if (collars && otherStock && 2 * (value(settings.length) + pitch) >= Math.abs(stock.station - otherStock.station))
    throw Error("The two cap collars would meet. Shorten the cap thread or lengthen the barrel.");

  const { name, prefix } = attachmentName(project, "cap");
  const ref = (field: string) => prefix + "_" + field;
  const inputs = [
    ["major", "Thread major diameter", preset.diameter], ["pitch", "Thread pitch", preset.pitch],
    ["thread_length", "Thread length", settings.length], ["allowance", "Diametral allowance", settings.allowance],
    ["length", "Cap length", settings.capLength], ["diameter", "Cap outside diameter", settings.capDiameter],
    ["wall", "End wall thickness", settings.wall],
  ];
  if (settings.crown !== "flat") inputs.push(["crown", "Crown length", settings.crownLength]);
  const parameters = [...project.parameters, ...inputs.map(([key, label, expression]) => ({ name: ref(key), label, expression }))];
  const profile = { prefix, crown: settings.crown };
  validateCapProfile(profile, resolveParameters(parameters));
  const body = uid();
  const refs = turningReferences(project, bodyId, stock, settings.end, values);
  const endPlane = refs.station ?? stock.station + " mm";
  const base = collars ? "(" + endPlane + ")" + (settings.end === "end" ? " - " : " + ") + ref("thread_length") : endPlane;
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
  const male: Finish = { ...shared, id: uid(), name: "Threads · barrel " + settings.end + (collars ? " collar" : " tenon"), end: settings.end,
    ...(collars ? { collarStockDiameter: refs.diameter ?? stock.outside + " mm" } : {}),
    preparation: collars ? "collar" : "tenon", preparationAxis: stock.axis, preparationCenter: stock.centerline,
    side: "external", diameter: ref("major") + " - " + ref("allowance") };
  const socket: Finish = { ...shared, id: uid(), name: "Threads · cap socket", end: settings.end === "end" ? "start" : "end",
    preparation: "socket", preparationAxis: "X", side: "internal", diameter: ref("major") };
  const next = addThreadedAttachment(project, bodyId, target.id, sketch, parameters, name, settings.end, ref, male, socket);
  if (otherStock) {
    const otherRefs = turningReferences(project, bodyId, otherStock, opposite, values);
    const second: Finish = { ...male, id: uid(), end: opposite, name: "Threads · barrel " + opposite + (collars ? " collar" : " tenon"),
      ...(collars ? { collarStockDiameter: otherRefs.diameter ?? otherStock.outside + " mm" } : {}),
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
