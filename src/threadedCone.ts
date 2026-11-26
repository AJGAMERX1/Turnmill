import { evaluate, resolveParameters } from "./expressions";
import { threadMinorDiameter, threadPresets, type Finish } from "./finishingTypes";
import type { FitSurface } from "./fitSurfaces";
import { turningReferences } from "./turningReferences";
import { defaultJoint } from "./kinematics";
import { partFeatures } from "./partTabs";
import { uid } from "./projects";
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
  return { axis, centerline: outer.centerline, station, outside: diam(outer), bore: Math.max(0, ...concentric.map(diam)) };
}

export function suggestedPairSize(end: BarrelEnd) {
  const target = 0.8 * end.outside;
  const scores = threadPresets.filter(p => p.label.startsWith("M")).map(p => {
    const dia = evaluate(p.diameter, {}), pitch = evaluate(p.pitch, {});
    return { p, dia, pitch, score: Math.abs(dia - target) + Math.abs(pitch - 0.75) / 4 };
  }).filter(({ dia, pitch }) => dia < end.outside && threadMinorDiameter(dia, pitch) >= end.bore - 1e-7);
  return scores.sort((a, b) => a.score - b.score)[0]?.p.label;
}

export function createThreadedCone(project: Project, bodyId: string, stock: BarrelEnd, settings: PairSettings) {
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
  if (major >= stock.outside) throw Error("Choose a smaller thread to leave material around the barrel socket.");
  if (threadMinorDiameter(major, pitch) < stock.bore - 1e-6)
    throw Error("The existing bore is larger than this thread’s pilot. Choose a larger thread or a finer pitch.");
  if (clearance < 0 || clearance >= major - threadMinorDiameter(major, pitch))
    throw Error("Reduce the diametral allowance so the thread flanks still engage.");
  if (!(value(settings.length) > 0 && value(settings.coneLength) > 0))
    throw Error("Give the cone and its threads a positive length.");
  if (opening < 0 || tip <= opening || tip >= stock.outside || opening >= threadMinorDiameter(major - clearance, pitch))
    throw Error("Keep the tip opening smaller than both the tip outside diameter and the thread root. The cone tip must be narrower than the barrel.");
  if (settings.backWall !== undefined && !(value(settings.backWall) > 0)) throw Error("Enter a positive back wall thickness.");

  const body = uid(), sketchId = uid(), maleId = uid(), socketId = uid();
  let prefix = "cone", index = 1;
  while (project.parameters.some(p => p.name.startsWith(prefix + "_")) ||
    project.features.some(f => f.name === (index === 1 ? "Screw-on cone" : "Screw-on cone " + index))) {
    index++; prefix = "cone" + index;
  }
  const name = index === 1 ? "Screw-on cone" : "Screw-on cone " + index;
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
  const cone: Feature = { id: body, name, kind: "revolve", operation: "new", amount: "360 deg",
    suppressed: false, sketchId, finishes: [male] };
  const travel = "(" + ref("thread_length") + " / " + ref("pitch") + ") * 360 deg";
  const joint = { ...defaultJoint(), kind: "screw", parent: bodyId,
    min: settings.end === "end" ? "0 deg" : "-(" + travel + ")",
    max: settings.end === "end" ? travel : "0 deg", threadMate: {
      moving: { featureId: body, finishId: maleId }, mating: { featureId: target.id, finishId: socketId },
      placement: "entrances", engagement: ref("thread_length"), phase: "180 deg",
    } } as const;
  const ws = project.workspaces;
  const next: Project = { ...project, parameters, sketches: [...project.sketches, sketch], features: [
    ...project.features.map(f => f.id === target.id ? { ...f, finishes: [...(f.finishes ?? []), socket] } : f), cone,
  ], workspaces: { ...ws, joints: { ...ws?.joints, [body]: joint },
    bodyMaterials: { ...ws?.bodyMaterials, [body]: ws?.bodyMaterials?.[bodyId] ?? ws?.material ?? "Brass" },
    ...(ws?.bodyDensities?.[bodyId] === undefined ? {} : { bodyDensities: { ...ws.bodyDensities, [body]: ws.bodyDensities[bodyId] } }),
  } };
  return { project: next, coneId: body };
}
