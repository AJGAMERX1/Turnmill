import { measureVolume } from "replicad";
import { Matrix4, Vector3 } from "three";
import { verifySlimFlush } from "./slimFlushGeometry";
import { verifyCapMount } from "./capClearanceGeometry";
import { solidBounds } from "./secondaryProjection";
import { evaluate, resolveParameters } from "./expressions";
import { collectFitSurfaces } from "./fitSurfaces";
import { buildBodies, releaseBodies, type Body, type FinishBodySnapshot } from "./geometry";
import { buildPoses } from "./kinematics";
import { positioned } from "./motionGeometry";
import { planRefillBacking } from "./refillBacking";
import { verifyRefillBackingStock } from "./refillBackingGeometry";
import { refillDimensions } from "./refills";
import { resolveThreadMates } from "./threadMates";
import { setCapMount, type CapMount } from "./threadedCone";
import type { EvaluatedFeature, Project } from "./types";
import { analyzeWritingFit } from "./writingFit";
import { measureWritingBodyGeometry } from "./writingFitGeometry";
import type { WritingJob } from "./writingFitJob";

function histories(features: EvaluatedFeature[]) {
  const out: EvaluatedFeature[][] = [];
  for (const f of features) {
    if (f.operation === "new") out.push([]);
    out.at(-1)!.push(f);
  }
  return out;
}

function overlap(refill: Body, housing: Body, transform: number[]) {
  const shape = positioned(refill.shape, transform);
  try {
    const common = shape.intersect(housing.shape);
    try {
      const volume = Math.abs(measureVolume(common));
      if (!Number.isFinite(volume)) throw Error("The solid intersection could not be measured.");
      return volume > 1e-7;
    } finally { common.delete(); }
  } finally { shape.delete(); }
}

function displaced(local: number[], axis: number[], distance: number) {
  const matrix = new Matrix4().fromArray(local);
  const shift = new Vector3().fromArray(axis).multiplyScalar(distance);
  return matrix.setPosition(new Vector3().setFromMatrixPosition(matrix).add(shift)).toArray();
}

export function checkWritingGeometry(job: WritingJob, live: Body[], current: EvaluatedFeature[]) {
  const old = histories(current), candidate = job.features ? histories(job.features) : old;
  if (candidate.length !== old.length || old.some((h,i) => h[0].id !== candidate[i][0].id))
    throw Error("The parts changed. Check the writing fit again.");
  const created: Body[] = [], snapshots: FinishBodySnapshot[] = [];
  try {
    const edited = new Set([job.setup.coneId, job.setup.barrelId]);
    if (job.slim) {
      for (const [id, mount] of Object.entries((job.project.workspaces?.capMounts ?? {}) as Record<string, CapMount>))
        if (mount.barrelId === job.setup.barrelId) edited.add(id);
    }
    const bodies = candidate.map((h,i) => {
      if (h === old[i] || JSON.stringify(h) === JSON.stringify(old[i])) return live[i];
      if (!edited.has(h[0].id))
        throw Error(h[0].name + " also changes through a shared parameter. Give that part its own dimension before resizing this pen.");
      const reuse = h.length > old[i].length && JSON.stringify(h.slice(0, old[i].length)) === JSON.stringify(old[i]);
      const body = reuse ? buildBodies(h.slice(old[i].length), { id: h[0].id, body: live[i] })[0] : buildBodies(h)[0];
      created.push(body);
      if (job.action === "verify") snapshots.push({ bodyId: h[0].id, history: JSON.stringify(h), brep: body.shape.serialize(),
        volume: Math.abs(measureVolume(body.shape)), threadFrames: body.threadFrames, guides: body.guides });
      return body;
    });
    const { project, setup } = job, { refillId, coneId, barrelId } = setup;
    const ids = candidate.map(h => h[0].id);
    const b = ids.indexOf(barrelId), c = ids.indexOf(coneId), r = ids.indexOf(refillId);
    if ([b,c,r].some(i => i < 0) || new Set([b,c,r]).size !== 3) throw Error("Restore the barrel, cone and refill before checking the fit.");
    const values = resolveParameters(project.parameters);
    const exposure = evaluate(setup.projection, values), play = evaluate(setup.endplay, values);
    if (play < 0 || play >= exposure) throw Error("Set endplay between zero and the tip projection so the refill still writes against the backstop.");
    const frames = bodies.flatMap(body => body.threadFrames ?? []);
    const poses = (p: Project) => buildPoses(ids, resolveThreadMates(p.workspaces?.joints ?? {}, frames, values, ids), p.workspaces?.jointPose ?? {}, values);
    const matrices = poses(project);
    const parts = new Set([c,b,r]);
    const surfaces = bodies.map((body,i) => parts.has(i) ? collectFitSurfaces(body.shape, ids[i], true) : []);
    const bodyGeometry = bodies.map((body,i) => parts.has(i) ? measureWritingBodyGeometry(body.shape) : undefined);
    const fit = analyzeWritingFit(project, { refillId, coneId, exposure, bodyIds: ids, matrices, surfaces, bodyGeometry });
    if (fit.barrelId !== barrelId) throw Error("Choose the barrel that carries this cone.");
    if (job.action === "measure") {
      const guide = refillDimensions(project, refillId)?.guide_diameter;
      const frontSeated = guide !== undefined && Math.abs(fit.openingDiameter - guide - evaluate(setup.clearance, values)) < 1e-5
        && !overlap(bodies[r], bodies[c], fit.coneLocal)
        && overlap(bodies[r], bodies[c], displaced(fit.coneLocal, [fit.coneInward,0,0], -0.05));
      try {
        const backing = planRefillBacking(project, fit, surfaces[b], play, frames);
        verifyRefillBackingStock(bodies[b].shape, backing);
        return { fit, backing, frontSeated };
      } catch (cause) {
        return { fit, frontSeated, problem: cause instanceof Error ? cause.message : "The rear stop could not be machined." };
      }
    }
    const pilot = candidate[c].find(f => f.operation === "add" && project.features.some(p => p.id === f.id && p.writingSeat));
    if (pilot) {
      const sleeve = buildBodies([{ ...pilot, operation: "new" }]);
      try {
        const coneToBarrel = new Matrix4().fromArray(matrices[b]).invert().multiply(new Matrix4().fromArray(matrices[c]));
        if (overlap(sleeve[0], bodies[b], coneToBarrel.toArray()))
          throw Error("The cone seat extension hits the barrel. Increase the barrel bore behind the screw-on cone.");
      } finally { releaseBodies(sleeve); }
    }
    const expected = new Matrix4().fromArray(matrices[b]).invert().multiply(new Matrix4().fromArray(matrices[r])).toArray();
    if (!expected.every((v,i) => Math.abs(v - fit.local[i]) < 1e-5) || fit.currentAlignment !== "aligned" || Math.abs(fit.currentExposure! - exposure) > 1e-5)
      throw Error("Seat the refill and tighten the cone to its writing position.");
    const guide = refillDimensions(project, refillId)?.guide_diameter;
    if (guide === undefined || Math.abs(fit.openingDiameter - guide - evaluate(setup.clearance, values)) > 1e-5)
      throw Error("The finished guide bore needs to match the requested clearance.");
    if (overlap(bodies[r], bodies[c], fit.coneLocal)) throw Error("The refill touches solid material inside the cone. Check its guide, shoulder and rear counterbore.");
    if (overlap(bodies[r], bodies[b], fit.local)) throw Error("The refill intersects the barrel. Increase its internal clearance or move the rear stop.");
    if (fit.rearGap === undefined || Math.abs(fit.rearGap - play) > 1e-5)
      throw Error("The finished rear stop does not match the requested endplay. Check the barrel bore at the refill tail.");
    const coneAxis = [fit.coneInward,0,0];
    if (!overlap(bodies[r], bodies[c], displaced(fit.coneLocal, coneAxis, -0.05)))
      throw Error("The refill can slip forwards through the cone. Its shoulder needs a positive seat.");
    if (play > 0 && (overlap(bodies[r], bodies[c], displaced(fit.coneLocal, coneAxis, play)) ||
        overlap(bodies[r], bodies[b], displaced(fit.local, fit.inward, play))))
      throw Error("The requested endplay pushes the refill into a shoulder. Reduce endplay or deepen the relief.");
    if (!overlap(bodies[r], bodies[b], displaced(fit.local, fit.inward, play + 0.05)))
      throw Error("The backing does not catch the cartridge tail under writing pressure.");
    function diameter(i: number, axis: "X" | "Z") {
      const [low, high] = bodyGeometry[i]?.bounds ?? solidBounds(bodies[i].shape);
      const across = axis === "X" ? 2 : 0;
      return Math.max(high[1] - low[1], high[across] - low[across]);
    }
    const diameters = { refill: diameter(r,"X"), barrel: diameter(b,fit.barrelAxis), cone: diameter(c,"X"), caps: [] as number[] };
    let caps = 0;
    for (const [id,mount] of Object.entries((project.workspaces?.capMounts ?? {}) as Record<string,CapMount>)) {
      if (mount.barrelId !== barrelId || !ids.includes(id)) continue;
      for (const end of ["start","end"] as const) {
        const mounted = setCapMount(project,id,end);
        const alternate = poses(mounted);
        const inv = new Matrix4().fromArray(alternate[ids.indexOf(id)]).invert();
        const local = inv.multiply(new Matrix4().fromArray(alternate[r])).toArray();
        const axis = new Vector3(fit.coneInward,0,0).transformDirection(new Matrix4().fromArray(alternate[c]))
          .transformDirection(new Matrix4().fromArray(alternate[ids.indexOf(id)]).invert()).toArray();
        for (const delta of [0, end === mount.front ? -0.1 : play + 0.1]) {
          if (overlap(bodies[r], bodies[ids.indexOf(id)], displaced(local,axis,delta)))
            throw Error("The refill needs more room inside " + bodies[ids.indexOf(id)].name + " at the " + (end === mount.front ? "writing" : "posted") + " end. Deepen its pocket and recheck.");
        }
        const capIndex = ids.indexOf(id);
        if (job.slim) verifySlimFlush(bodies[b], bodies[capIndex], mounted.workspaces!.joints[id], alternate[b], alternate[capIndex]);
        const group = [b,c,r,capIndex];
        verifyCapMount(group.map(i => bodies[i]), group.map(i => ids[i]), id, group.map(i => alternate[i]), mounted.workspaces!.joints[id]);
      }
      diameters.caps.push(diameter(ids.indexOf(id),"X"));
      caps++;
    }
    const barrelBores = surfaces[b].filter(s => s.side === "bore" && Math.abs(s.axis[fit.barrelAxis === "X" ? 0 : 2]) > 1 - 1e-7 &&
      s.centerline.every(n => Math.abs(n) < 1e-5)).map(s => s.diameter);
    const barrelEnds = bodyGeometry[b]!.bounds.map(p => p[fit.barrelAxis === "X" ? 0 : 2]);
    return { fit, checkedBodies: snapshots, caps, diameters, barrelBores, barrelEnds };
  } finally { releaseBodies(created); }
}
