import { Matrix4, Vector3 } from "three";
import { makeRefillSnapJoint } from "./assemblyRefillSnap";
import { evaluate, resolveParameters } from "./expressions";
import { screwConeProfile } from "./screwConeProfile";
import type { FitSurface } from "./fitSurfaces";
import { refillBoreChecks, type RefillBoreCheck } from "./refillClearance";
import { seatRefill } from "./refillSeating";
import { isSleeveDonor, refillComponents, refillDimensions } from "./refills";
import { isRigidTransform } from "./rigidTransform";
import type { JointConfig } from "./kinematics";
import type { Project } from "./types";

type XYZ = [number, number, number];
const tolerance = 1e-5;
export type WritingSeatFace = { axis: "X" | "Z"; direction: number; center: XYZ; inner: number; outer: number };
export type WritingBodyGeometry = { bounds: [XYZ, XYZ]; seats: WritingSeatFace[] };
export type WritingFitInput = {
  refillId: string; coneId: string; exposure: number; bodyIds: string[];
  matrices: number[][]; surfaces: FitSurface[][]; bodyGeometry: (WritingBodyGeometry | undefined)[];
};
type Nose = { coneId: string; barrelId: string; name: string; tipEnd: "start" | "end" };

export function writingNoses(project: Project): Nose[] {
  const noses: Nose[] = [];
  const joints: JointConfig = project.workspaces?.joints ?? {};
  for (const [coneId, joint] of Object.entries(joints)) {
    const mate = joint.threadMate;
    if (!mate || !joint.parent || mate.moving.featureId !== coneId) continue;
    const f = project.features.find(f => f.id === coneId && !f.suppressed && f.operation === "new" && f.kind === "revolve");
    const tenon = f?.finishes?.find(t => t.id === mate.moving.finishId && !t.suppressed);
    const socket = project.features.find(f => f.id === mate.mating.featureId && !f.suppressed)
      ?.finishes?.find(t => t.id === mate.mating.finishId && !t.suppressed);
    if (!f || tenon?.kind !== "thread" || tenon.preparation !== "tenon" || tenon.side !== "external" ||
        socket?.kind !== "thread" || socket.preparation !== "socket" || socket.side !== "internal") continue;
    noses.push({ coneId, barrelId: joint.parent, name: f.name, tipEnd: tenon.end === "start" ? "end" : "start" });
  }
  return noses;
}

export type WritingFit = {
  refillId: string; coneId: string; barrelId: string;
  currentExposure?: number; currentAlignment: "aligned" | "reversed" | "off-axis"; requestedExposure: number;
  coneClearance?: RefillBoreCheck; barrelClearance?: RefillBoreCheck; openingDiameter: number; rimDiameter: number;
  coneTipX: number; coneInward: 1 | -1;
  tailPoint: XYZ; tailDiameter: number; inward: XYZ; barrelAxis: "X" | "Z"; barrelRearStation: number;
  rearStatus: "open" | "gap" | "contact" | "interference" | "unknown"; rearGap?: number; rearStopInnerDiameter?: number; rearEndDistance: number;
  local: number[]; coneLocal: number[];
};

function rearSupport(barrel: WritingBodyGeometry, barrelLands: FitSurface[], axis: "X" | "Z",
  tail: XYZ, sign: number, tailDiameter: number, length: number, diameterAt: (gap: number) => number) {
  const index = axis === "X" ? 0 : 2;
  const station = barrel.bounds[sign > 0 ? 1 : 0][index];
  const endDistance = sign * (station - tail[index]);
  const centered = (p: XYZ) => p.every((n, i) => i === index || Math.abs(n - tail[i]) < tolerance);
  const stops = barrel.seats.filter(f => f.axis === axis && f.direction === -sign && centered(f.center) && f.outer > tolerance)
    .map(f => ({ gap: (f.center[index] - tail[index]) * sign, inside: f.inner }))
    .filter(s => s.gap >= -length + tolerance &&
      s.inside < (s.gap < -tolerance ? diameterAt(s.gap) : tailDiameter) - tolerance)
    .sort((a, b) => a.gap - b.gap);
  const stop = stops[0];
  let rearStatus: WritingFit["rearStatus"] = "unknown";
  let rearGap: number | undefined;
  if (stop) {
    rearGap = Math.abs(stop.gap) < tolerance ? 0 : stop.gap;
    rearStatus = rearGap < 0 ? "interference" : rearGap === 0 ? "contact" : "gap";
  } else if (barrelLands.some(s => s.side === "bore" && Math.abs(s.axis[index] - 1) < tolerance &&
    centered(s.centerline) && Math.abs((sign > 0 ? s.end : s.start) - station) < tolerance && s.diameter >= tailDiameter - tolerance)) {
    rearStatus = "open";
  }
  return { barrelRearStation: station, rearEndDistance: endDistance, rearStatus, rearGap, rearStopInnerDiameter: stop?.inside };
}

/** Use only the finished catalog solid's outer lands and tapers, in its own coordinates. */
function refillDiameterAt(lands: FitSurface[], x: number) {
  let diameter = 0;
  for (const s of lands) {
    if (s.side !== "shaft" || Math.abs(s.axis[0]) < 1 - tolerance ||
        Math.hypot(s.centerline[1], s.centerline[2]) > tolerance) continue;
    const station = x * s.axis[0];
    if (station < s.start - tolerance || station > s.end + tolerance) continue;
    const t = Math.max(0, Math.min(1, (station - s.start) / (s.end - s.start)));
    diameter = Math.max(diameter, s.diameter + ((s.endDiameter ?? s.diameter) - s.diameter) * t);
  }
  return diameter;
}

export function analyzeWritingFit(project: Project, input: WritingFitInput): WritingFit {
  const { refillId, coneId, bodyIds, matrices, surfaces, bodyGeometry } = input;
  const cone = writingNoses(project).find(n => n.coneId === coneId);
  const refill = refillComponents(project).find(r => r.bodyId === refillId);
  const dimensions = refillDimensions(project, refillId);
  if (!cone || !refill || !dimensions) throw Error("Choose a catalog refill and a screw-on cone attached to its barrel.");
  const { barrelId } = cone;
  const r = bodyIds.indexOf(refillId), c = bodyIds.indexOf(coneId), b = bodyIds.indexOf(barrelId);
  const refillGeometry = bodyGeometry[r], coneGeometry = bodyGeometry[c], barrelGeometry = bodyGeometry[b];
  if (!refillGeometry || !coneGeometry || !barrelGeometry || [r, c, b].some(i =>
    !surfaces[i] || !isRigidTransform(matrices[i]))) throw Error("Rebuild the refill, cone and barrel to measure their saved assembly positions.");
  const length = dimensions.length, tipX = refill.reversed ? length : 0, tailX = refill.reversed ? 0 : length;
  if (Math.abs(refillGeometry.bounds[0][0]) > tolerance || Math.abs(refillGeometry.bounds[1][0] - length) > tolerance)
    throw Error("The finished refill no longer matches its tip-to-tail dimension. Update the refill geometry before measuring a writing fit.");
  const tailDiameter = refillDiameterAt(surfaces[r], tailX);
  if (tailDiameter <= 0) throw Error("The refill needs a measurable round tail to size its rear support.");
  const donor = isSleeveDonor(refill.kind);
  const requestedExposure = donor ? dimensions.seat_distance : input.exposure;
  if (!(requestedExposure > 0 && requestedExposure < length))
    throw Error("Set a positive writing tip exposure shorter than the refill.");
  if (!donor && requestedExposure >= dimensions.shoulder_distance - tolerance)
    throw Error("Keep the first refill shoulder inside the cone. Set the tip exposure below " +
      Number(dimensions.shoulder_distance.toFixed(3)) + " mm.");

  const coneInward = cone.tipEnd === "start" ? 1 : -1;
  const coneTipX = coneGeometry.bounds[coneInward === 1 ? 0 : 1][0];
  const rim = coneGeometry.seats.find(f => f.axis === "X" && f.direction === -coneInward &&
    Math.abs(f.center[0] - coneTipX) < tolerance && Math.hypot(f.center[1], f.center[2]) < tolerance);
  if (!rim) throw Error("The cone needs a flat, round tip face to measure writing exposure.");
  const coneLocal = seatRefill(project, refillId, { bodyId: coneId, key: coneId + ":tip", axis: [1,0,0],
    centerline: [0,0,0], end: cone.tipEnd, station: coneTipX, diameter: rim.inner }, requestedExposure);

  const barrelInverse = new Matrix4().fromArray(matrices[b]).invert();
  const coneWorld = new Matrix4().fromArray(matrices[c]);
  const coneToBarrel = barrelInverse.clone().multiply(coneWorld);
  const local = coneToBarrel.clone().multiply(coneLocal);
  const inward = new Vector3(coneInward, 0, 0).transformDirection(coneToBarrel);
  const barrelAxis = Math.abs(inward.x) > 1 - 1e-8 ? "X" : Math.abs(inward.z) > 1 - 1e-8 ? "Z" : undefined;
  if (!barrelAxis) throw Error("Seat the cone on an X- or Z-axis barrel before sizing the refill backing.");
  const root = project.features.find(f => f.id === coneId);
  const sketch = project.sketches.find(s => s.id === root?.sketchId);
  if (sketch && screwConeProfile(project, sketch, root)) {
    const baseX = evaluate(sketch.points[0].x, resolveParameters(project.parameters));
    const shoulder = new Vector3(baseX, 0, 0).applyMatrix4(coneToBarrel);
    const barrelIndex = barrelAxis === "X" ? 0 : 2;
    const inwardSign = Math.sign(inward.getComponent(barrelIndex));
    const barrelFront = barrelGeometry.bounds[inwardSign > 0 ? 0 : 1][barrelIndex];
    if (Math.abs(shoulder.getComponent(barrelIndex) - barrelFront) > tolerance)
      throw Error("Fully seat the screw-on cone against the barrel before sizing the refill. Check its engagement and saved screw position in Assembly.");
  }
  const tail = new Vector3(tailX, 0, 0).applyMatrix4(local);
  const support = rearSupport(barrelGeometry, surfaces[b], barrelAxis, tail.toArray(), Math.sign(inward[barrelAxis === "X" ? "x" : "z"]),
    tailDiameter, length, gap => refillDiameterAt(surfaces[r], tailX + (refill.reversed ? -gap : gap)));

  const relative = coneWorld.clone().invert().multiply(new Matrix4().fromArray(matrices[r]));
  const direction = new Vector3(refill.reversed ? -1 : 1,0,0).transformDirection(relative);
  const tip = new Vector3(tipX,0,0).applyMatrix4(relative);
  const aligned = Math.hypot(tip.y, tip.z) < tolerance && Math.hypot(direction.y, direction.z) < 1e-7;
  const currentAlignment = !aligned ? "off-axis" : direction.x * coneInward < 0 ? "reversed" : "aligned";

  const checks = refillBoreChecks(refillId, [refillId, coneId, barrelId], [surfaces[r], surfaces[c], surfaces[b]],
    [local.toArray(), coneToBarrel.toArray(), new Matrix4().toArray()]);
  return { refillId, coneId, barrelId, requestedExposure, currentAlignment,
    currentExposure: currentAlignment === "aligned" ? (coneTipX - tip.x) * coneInward : undefined,
    openingDiameter: rim.inner, rimDiameter: rim.outer, coneTipX, coneInward, barrelAxis, tailPoint: tail.toArray(), tailDiameter, inward: inward.toArray(),
    coneClearance: checks.find(s => s.bodyId === coneId), barrelClearance: checks.find(s => s.bodyId === barrelId),
    ...support, local: local.toArray(), coneLocal: coneLocal.toArray() };
}

export function applyWritingPose(project: Project, fit: WritingFit): Project {
  const joints: JointConfig = project.workspaces?.joints ?? {};
  const joint = makeRefillSnapJoint(joints, fit.refillId, fit.barrelId, new Matrix4().fromArray(fit.local));
  return { ...project, workspaces: { ...project.workspaces, joints: { ...joints, [fit.refillId]: joint },
    jointPose: { ...project.workspaces?.jointPose, [fit.refillId]: [] } } };
}
