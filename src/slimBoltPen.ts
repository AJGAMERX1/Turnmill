import { measureVolume } from "replicad";
import { Matrix4 } from "three";
import { boltPenProject } from "./boltPen";
import { boltTrackPosition, resolveBoltTrack } from "./boltTrack";
import { evaluateModel } from "./buildModel";
import { checkPair } from "./clearance";
import { evaluate, resolveParameters } from "./expressions";
import { buildBodies, releaseBodies } from "./geometry";
import { bodyIds, buildPoses, type JointConfig } from "./kinematics";
import { positioned } from "./motionGeometry";
import { isSleeveDonor, refillComponents } from "./refills";
import { solidBounds } from "./secondaryProjection";
import { measureWritingBodyGeometry } from "./writingFitGeometry";
import { readSlimAllowances, type SlimSettings } from "./slimSizing";
import type { Project, Sketch } from "./types";

const barrel = "bolt-barrel", carrier = "bolt-carrier", refill = "bolt-refill", nose = "bolt-nose";
const eps = 1e-6;
const mm = (n: number) => Number(n.toPrecision(14)) + " mm";

function boltTemplate(project: Project) {
  const reference = boltPenProject();
  const record = project.workspaces?.boltPen, saved = project.workspaces?.slimBolt;
  const mismatch = () => Error("This bolt mechanism has custom geometry or joints. Use the stock bolt-action assembly for automatic slimming.");
  if (record?.barrelId !== barrel || record.carrierId !== carrier || record.refillId !== refill || record.noseId !== nose ||
    project.features.length !== reference.features.length) throw mismatch();
  for (const [index, expected] of reference.features.entries()) {
    const actual = project.features[index];
    if (actual.id !== expected.id || actual.kind !== expected.kind || actual.operation !== expected.operation || actual.suppressed ||
      actual.advanced || actual.operations?.length || actual.finishes?.length || actual.merge || actual.bodyId !== expected.bodyId ||
      actual.amount !== expected.amount) throw mismatch();
    if (actual.id === refill) continue;
    const original = reference.sketches.find(s => s.id === expected.sketchId)!;
    const sketch = project.sketches.find(s => s.id === actual.sketchId);
    const points = original.points.map((p, i) => actual.id === nose && saved?.tipRaise > 0 && (i === 1 || i === 2)
      ? { ...p, y: "(" + p.y + ") + " + mm(saved.tipRaise) } : p);
    if (!sketch || JSON.stringify(sketch.points) !== JSON.stringify(points) ||
      JSON.stringify(sketch.constraints) !== JSON.stringify(original.constraints)) throw mismatch();
  }
  const config: JointConfig = project.workspaces?.joints ?? {};
  for (const [id, expected] of Object.entries(reference.workspaces!.joints as JointConfig)) {
    if (JSON.stringify(config[id]) !== JSON.stringify(expected)) throw mismatch();
  }
  const installed = refillComponents(project).find(r => r.bodyId === refill);
  if (!installed || installed.reversed || isSleeveDonor(installed.kind))
    throw Error("Use a forward-facing refill carried by the bolt to size this mechanism.");
  return reference;
}

// At each end of an axial interval the difference of the straight inner and
// outer meridians is linear. Checking both sides also captures vertical steps.
function wallSections(sketch: Sketch, values: Record<string, number>) {
  const points = sketch.points.map(p => ({ x: evaluate(p.x, values), r: evaluate(p.y, values) }));
  const edges = points.map((p, i) => [p, points[(i + 1) % points.length]]);
  const xs = [...new Set(points.map(p => p.x))].sort((a, b) => a - b);
  const result: { x: number; thickness: number }[] = [];
  for (let i = 1; i < xs.length; i++) {
    const lo = xs[i - 1], hi = xs[i], mid = (lo + hi) / 2;
    const crossing = edges.filter(([a, b]) => Math.min(a.x, b.x) < mid && Math.max(a.x, b.x) > mid);
    if (crossing.length !== 2) throw Error("Check the axial section of the bolt body before slimming.");
    for (const x of [lo, hi]) {
      const r = crossing.map(([a, b]) => a.r + (b.r - a.r) * (x - a.x) / (b.x - a.x)).sort((a, b) => a - b);
      result.push({ x, thickness: r[1] - r[0] });
    }
  }
  return result;
}

export async function previewSlimBolt(project: Project, settings: SlimSettings) {
  const reference = boltTemplate(project);
  const old = resolveParameters(project.parameters);
  const { wall, clearance, allowance } = readSlimAllowances(settings, old);
  if (old.spring_space <= old.bolt_throw || old.guide_clearance <= 0)
    throw Error("Increase the return spring space or restore the tip-guide clearance before slimming.");
  const source = await evaluateModel(project);
  const sourceRefill = buildBodies([source.features.find(f => f.id === refill)!]);
  let widest: number;
  try {
    const [lo, hi] = solidBounds(sourceRefill[0].shape);
    widest = Number(Math.max(hi[1] - lo[1], hi[2] - lo[2]).toFixed(6));
  } finally { releaseBodies(sourceRefill); }
  const bore = widest + clearance, requested = settings.method === "diameter" ? widest + allowance : bore + 2 * wall;
  // The standard 8 × 1 mm retention ring has a Ø9.82 installed envelope.
  // Its fixed gland, spring chamber and carrier get independent allowances.
  const minimum = Math.max(9.82 + 2 * (.16 + wall), old.carrier_bore + 2 * (.13 + wall), bore + 2 * (.38 + wall));
  const diameter = Math.max(minimum, Math.min(requested, old.grip_diameter));
  if (diameter > old.grip_diameter + eps || 4.15 - bore / 2 < wall - eps || bore >= old.carrier_bore - eps)
    throw Error("The nose O-ring gland, carrier and return spring chamber need more material. Reduce the minimum wall or running clearance to slim this bolt pen.");
  // The fixed return spring sits on the bore transition: widening this
  // shoulder would take away previously available spring-bearing material.
  const springSeatBore = project.workspaces?.slimBolt?.springSeatBore ?? old.chamber_bore;
  if (!Number.isFinite(springSeatBore) || bore > springSeatBore + eps)
    throw Error("This running clearance would enlarge the existing spring-seat opening. Reduce the running clearance to retain its bearing surface.");
  const changes: Record<string, string> = {
    grip_diameter: mm(diameter), chamber_bore: mm(bore),
    barrel_wall: "(grip_diameter - " + mm(old.carrier_bore) + ") / 2"
  };
  const parameters = project.parameters.map(p => changes[p.name] ? { ...p, expression: changes[p.name] } : p);
  const values = resolveParameters(parameters);
  if (Math.abs(values.carrier_bore - old.carrier_bore) > eps || Math.abs(values.spring_seat - old.spring_seat) > eps ||
    Math.abs(values.spring_space - old.spring_space) > eps || Math.abs(values.bolt_throw - old.bolt_throw) > eps)
    throw Error("Restore the stock carrier, throw and spring-space drivers before slimming.");
  const originalNose = reference.sketches.find(s => s.partId === nose)!;
  const noseSource = project.sketches.find(s => s.id === project.features.find(f => f.id === nose)!.sketchId)!;
  let tipRaise = 0;
  for (const { x, thickness } of wallSections(originalNose, values)) {
    if (thickness >= wall - eps) continue;
    // Lift only the writing lip and its adjacent bevel. The grooved grip and
    // standard ring gland keep their original stations and section dimensions.
    const weight = x <= 1.4 ? 1 : Math.max(0, (9.8 - x) / (9.8 - 1.4));
    if (weight < eps) throw Error("The fixed nose gland leaves too little radial wall. Reduce the wall or running clearance.");
    tipRaise = Math.max(tipRaise, (wall - thickness) / weight);
  }
  const raised = {
    ...noseSource, points: originalNose.points.map((p, i) => tipRaise > 0 && (i === 1 || i === 2)
      ? { ...p, y: "(" + p.y + ") + " + mm(tipRaise) } : p)
  };
  if (wallSections(raised, values).some(s => s.thickness < wall - eps) ||
    raised.points.some(p => evaluate(p.y, values) > diameter / 2 + eps))
    throw Error("The requested guide wall would exceed the grip diameter. Reduce the minimum wall.");
  const barrelSketch = project.sketches.find(s => s.partId === barrel)!;
  if (wallSections(barrelSketch, values).some(s => s.thickness < wall - eps))
    throw Error("The slotted barrel does not retain the selected radial wall. Increase the grip diameter.");
  const config = project.workspaces!.joints as JointConfig;
  const priorTrack = resolveBoltTrack(config[carrier].bolt, old), track = resolveBoltTrack(config[carrier].bolt, values);
  const drivers = { ...project.workspaces?.jointPose };
  if (drivers[carrier]?.length) {
    const d = Math.max(0, Math.min(priorTrack.total, drivers[carrier][0]));
    const v = d <= track.stroke ? d : track.stroke + Math.min(1, (d - track.stroke) / priorTrack.arc) * track.arc +
      Math.max(0, d - priorTrack.stroke - priorTrack.arc);
    drivers[carrier] = [v];
  }
  const next = {
    ...project, parameters, sketches: project.sketches.map(s => s === noseSource ? raised : s),
    workspaces: { ...project.workspaces, jointPose: drivers, slimBolt: { ...settings, tipRaise, springSeatBore } }
  };
  const evaluated = await evaluateModel(next), bodies = buildBodies(evaluated.features), ids = bodyIds(evaluated.features);
  try {
    const byId = (id: string) => bodies[ids.indexOf(id)], at = (id: string) => ids.indexOf(id);
    for (const id of [barrel, nose, "bolt-tail"]) {
      const [lo, hi] = solidBounds(byId(id).shape);
      if (Math.abs(Math.max(hi[1] - lo[1], hi[2] - lo[2]) - diameter) > 1e-4)
        throw Error("The rebuilt barrel, nose and tail must share the selected diameter.");
    }
    const seats = measureWritingBodyGeometry(byId(barrel).shape).seats;
    const springSeat = seats.find(s => s.axis === "X" && s.direction === 1 && Math.abs(s.center[0] - values.spring_seat) < eps &&
      Math.abs(s.outer - old.carrier_bore) < eps && Math.abs(s.inner - bore) < eps);
    const carrierFront = solidBounds(byId(carrier).shape)[0][0];
    const carrierSeat = measureWritingBodyGeometry(byId(carrier).shape).seats.find(s =>
      s.axis === "X" && s.direction === -1 && Math.abs(s.center[0] - carrierFront) < eps);
    if (!springSeat || !carrierSeat || Math.min(carrierSeat.outer, springSeat.outer) <= Math.max(carrierSeat.inner, springSeat.inner) + eps ||
      Math.abs(carrierFront - springSeat.center[0] - old.spring_space) > eps)
      throw Error("The return spring needs two facing annular seats at the original spacing. Check the carrier and spring chamber.");
    // The circular stud is a revolved meridian installed radially. The clip
    // blade is an extrusion in +/- Z. These are their exact radii about the
    // barrel axis, and rotation about that axis preserves the swept envelope.
    const stud = evaluated.features.find(f => f.id === "bolt-stud")!;
    const clip = evaluated.features.find(f => f.id === "bolt-clip-blade")!;
    const envelope = 2 * Math.max(diameter / 2, ...stud.points.map(([x, r]) => Math.hypot(x, r)),
      ...clip.points.map(([, y]) => Math.hypot(y, clip.amount)));
    const poses = (d: number) => buildPoses(ids, config, { ...drivers, [carrier]: [d] }, values);
    const pocket = poses(0);
    const studToCarrier = new Matrix4().fromArray(pocket[at(carrier)]).invert().multiply(new Matrix4().fromArray(pocket[at("bolt-stud")]));
    const movingStud = positioned(byId("bolt-stud").shape, studToCarrier.toArray());
    let slotGap: number;
    try {
      const check = await checkPair([{ name: "Stud", shape: movingStud }, byId(barrel)], [carrier, barrel], {
        id: carrier, pair: barrel, type: "check", range: true, coordinate: 0, config, drivers, values,
        token: 1, version: 1, maxProbes: 1025, requiredGap: 0,
      });
      if (check.status !== "clear" || !(check.lowerBound! > 0))
        throw Error("The thumb stud cannot be verified clear across the entire J-slot. Increase the barrel diameter or restore the slot dimensions.");
      slotGap = check.lowerBound!;
    } finally { movingStud.delete(); }
    for (const d of [0, track.stroke / 2, track.stroke, track.stroke + track.arc / 2, track.stroke + track.arc, track.total]) {
      const matrices = poses(d);
      const barrelInverse = new Matrix4().fromArray(matrices[at(barrel)]).invert();
      const parts = bodies.map((b, i) => positioned(b.shape, barrelInverse.clone().multiply(new Matrix4().fromArray(matrices[i])).toArray()));
      try {
        const tip = solidBounds(parts[at(refill)])[0][0], noseTip = solidBounds(parts[at(nose)])[0][0];
        if (Math.abs(tip - noseTip - (values.pocket_recess + boltTrackPosition(track, d).axial)) > 1e-4)
          throw Error("The resized pen has lost its pocket recess or writing projection.");
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i].boundingBox, b = parts[j].boundingBox;
          try { if (a.isOut(b)) continue; } finally { a.delete(); b.delete(); }
          const common = parts[i].intersect(parts[j]);
          try {
            if (!(Math.abs(measureVolume(common)) <= 1e-7))
              throw Error(bodies[i].name + " overlaps " + bodies[j].name + " during bolt travel. Increase the body diameter or check the refill dimensions.");
          }
          finally { common.delete(); }
        }
      } finally { parts.forEach(p => p.delete()); }
    }
    return {
      project: next, requested, diameter, bore, widest, wall, previous: old.grip_diameter, envelope, slotGap,
      exposure: values.tip_projection, recess: values.pocket_recess, springOpen: values.spring_space,
      springPressed: values.spring_space - track.stroke, carrierBore: values.carrier_bore
    };
  } finally { releaseBodies(bodies); }
}
