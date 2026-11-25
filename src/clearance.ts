import { getOC, measureVolume, type Shape3D } from "replicad";
import { Matrix4 } from "three";
import { evaluate } from "./expressions";
import {
  buildPoses,
  type JointConfig,
  defaultJoint,
  limits,
  specs,
  screwLead,
  camTravelSpeed,
  jointTravelProblem,
} from "./kinematics";
import type { Body } from "./geometry";
import { threadClearanceBound } from "./threadClearance";

export type Probe = {
  maxProbes?: number;
  requiredGap?: number;
  type: "check";
  token: number;
  version: number;
  id: string;
  pair: string;
  coordinate: number;
  config: JointConfig;
  drivers: Record<string, number[]>;
  values: Record<string, number>;
  range: boolean;
};
export type ClearanceResult = {
  id: string;
  pair: string;
  status: "clear" | "contact" | "interference" | "below-target" | "unresolved";
  coordinate: number;
  sampledGap: number;
  lowerBound?: number;
  probes: number;
  overlap?: number;
  message: string;
};
import { positioned, shapeTolerance } from "./motionGeometry";
function ancestry(id: string, config: JointConfig) {
  const chain: string[] = [];
  while (id && !chain.includes(id)) {
    chain.push(id);
    id = config[id]?.parent || "";
  }
  return chain;
}
// Axial or 3D radius from the local pivot bounds every material point.
// Mount and parent transforms are rigid and preserve this displacement bound.
function speedBound(
  shape: Shape3D,
  request: Probe,
  values: Record<string, number>,
  other: string,
) {
  const { config, id, coordinate } = request,
    j = config[id] || defaultJoint();
  const moving = ancestry(id, config),
    fixed = ancestry(other, config);
  let speed = 0;
  if (!fixed.includes(id)) {
    const spec = specs(j.kind)[coordinate];
    if (spec.unit === "length") speed = 1;
    else {
      const box = shape.boundingBox;
      try {
        const [lo, hi] = box.bounds,
          pivot = j.origin.map((q) => evaluate(q, values));
        const extents = pivot.map((p, i) =>
          Math.max(Math.abs(lo[i] - p), Math.abs(hi[i] - p)),
        );
        if (j.kind !== "ball") extents[{ X: 0, Y: 1, Z: 2 }[j.axis]] = 0;
        const degrees = Math.PI / 180;
        speed = Math.hypot(
          degrees * Math.hypot(...extents),
          j.kind === "screw" ? screwLead(j, values) / 360 : 0,
        );
      } finally {
        box.delete();
      }
    }
  }
  // A cam follower translates independently of the parent tree. Common motion
  // cancels, and fixed descendants inherit their follower's displacement.
  for (const branch of new Set([...moving, ...fixed])) {
    const follower = config[branch];
    if (
      follower?.cam?.driver === id &&
      moving.includes(branch) !== fixed.includes(branch)
    )
      speed += camTravelSpeed(follower, j, coordinate, values);
  }
  return speed;
}
export async function checkPair(
  bodies: Body[],
  ids: string[],
  request: Probe,
  onProgress: (message: string) => void = () => {},
  cancelled: () => boolean = () => false,
): Promise<ClearanceResult> {
  const { id, pair, coordinate, config, drivers, values } = request;
  const ai = ids.indexOf(id),
    bi = ids.indexOf(pair);
  if (ai < 0 || bi < 0 || ai === bi)
    throw Error("Choose two different components.");
  const required = request.requiredGap ?? 0;
  const tolerance =
    1e-5 + shapeTolerance(bodies[ai].shape) + shapeTolerance(bodies[bi].shape);
  if (!Number.isFinite(required) || required < 0)
    throw Error("Enter a nonnegative minimum clearance.");
  const joint = config[id] || defaultJoint(),
    dof = specs(joint.kind)[coordinate];
  if (request.range && joint.cam)
    throw Error(
      "Drive the parent cam to check the follower through its travel.",
    );
  if (request.range && dof) {
    const problem = jointTravelProblem(
      ids,
      config,
      drivers,
      values,
      id,
      coordinate,
    );
    if (problem) throw Error(problem);
  }
  const [lo, hi] = dof ? limits(joint, coordinate, values) : [0, 0];
  const now = Math.max(lo, Math.min(hi, drivers[id]?.[coordinate] ?? 0));
  const unit = dof?.unit === "angle" ? "°" : "mm";
  const oc = getOC(),
    solver = new oc.BRepExtrema_DistShapeShape();
  let minGap = Infinity,
    minAt = now,
    probes = 0;
  const result = (
    status: ClearanceResult["status"],
    message: string,
    extra: Partial<ClearanceResult> = {},
  ): ClearanceResult => ({
    id,
    pair,
    status,
    message,
    coordinate: minAt,
    sampledGap: minGap,
    probes,
    ...extra,
  });
  function sample(v: number) {
    if (cancelled()) throw Error("Clearance check canceled.");
    const axes = [...(drivers[id] || [])];
    axes[coordinate] = v;
    const transforms = buildPoses(
      ids,
      config,
      { ...drivers, [id]: axes },
      values,
    );
    // Work in the comparator frame so its exact geometry and extrema cache stay fixed.
    const relative = new Matrix4()
      .fromArray(transforms[bi])
      .invert()
      .multiply(new Matrix4().fromArray(transforms[ai]));
    const a = positioned(bodies[ai].shape, relative.toArray());
    try {
      solver.LoadS2(a.wrapped);
      if (!solver.Perform() || !solver.IsDone())
        throw Error("The distance solver did not converge at this pose.");
      const gap = solver.Value();
      if (!Number.isFinite(gap))
        throw Error("The distance solver returned no finite gap.");
      probes++;
      if (gap < minGap) {
        minGap = gap;
        minAt = v;
      }
      let overlap = 0;
      if (gap <= tolerance) {
        const common = a.intersect(bodies[bi].shape);
        try {
          overlap = Math.abs(measureVolume(common));
        } finally {
          common.delete();
        }
        if (!Number.isFinite(overlap))
          throw Error("Could not measure the volume of intersection.");
      }
      return { v, gap, overlap };
    } finally {
      a.delete();
    }
  }
  type Sample = ReturnType<typeof sample>;
  function witness(s: Sample, where: string) {
    const common = { coordinate: s.v, sampledGap: s.gap, overlap: s.overlap };
    if (s.overlap > 0)
      return result(
        s.overlap <= 1e-7 ? "unresolved" : "interference",
        (s.overlap <= 1e-7
          ? "Possible overlap below modeling resolution"
          : "Interference") +
          where +
          " · " +
          (s.overlap < 1e-5
            ? s.overlap.toExponential(3)
            : s.overlap.toFixed(5)) +
          " mm³ overlap.",
        common,
      );
    if (s.gap < required - tolerance)
      return result(
        "below-target",
        "Below minimum clearance" +
          where +
          " · " +
          s.gap.toFixed(5) +
          " mm measured, " +
          required +
          " mm required.",
        common,
      );
    if (s.gap <= tolerance)
      return result(
        "contact",
        "Contact" +
          where +
          " · " +
          s.gap.toFixed(5) +
          " mm (contact within kernel tolerance).",
        common,
      );
  }
  const sampled = () =>
    "Smallest sampled gap " +
    minGap.toFixed(5) +
    " mm at " +
    minAt.toFixed(3) +
    unit +
    ".";
  const proven = (bound: number, via: string) =>
    result(
      "clear",
      "Clear throughout this joint travel · conservative nominal gap ≥ " +
        (Math.floor(bound * 1e5) / 1e5).toFixed(5) +
        " mm. " +
        (via ? via + " " : "") +
        sampled(),
      { lowerBound: bound },
    );
  try {
    solver.SetDeflection(1e-7);
    solver.LoadS1(bodies[bi].shape.wrapped);
    if (!request.range || !dof) {
      const s = sample(now);
      return (
        witness(s, " at this pose") ||
        (s.gap - tolerance < required
          ? result(
              "unresolved",
              "Current gap " +
                s.gap.toFixed(5) +
                " mm is within modeling tolerance of the required " +
                required +
                " mm.",
            )
          : result(
              "clear",
              "Current pose · " + s.gap.toFixed(5) + " mm minimum nominal gap.",
              { lowerBound: s.gap - tolerance },
            ))
      );
    }
    const speed = speedBound(bodies[ai].shape, request, values, pair);
    let contact = "";
    function rangeWitness(s: Sample) {
      const hit = witness(s, " at " + s.v.toFixed(3) + unit);
      if (hit?.status === "contact" && speed !== 0) {
        if (!contact) contact = hit.message;
        return;
      }
      return hit;
    }
    const first = sample(lo);
    let issue = rangeWitness(first);
    if (issue) return issue;
    if (speed === 0) {
      const lowerBound = first.gap - tolerance;
      if (lowerBound < required)
        return result(
          "unresolved",
          "Constant relative pose within modeling tolerance of the minimum clearance.",
        );
      return result(
        "clear",
        "Constant relative pose · " +
          first.gap.toFixed(5) +
          " mm nominal gap over this travel.",
        { lowerBound },
      );
    }
    const last = sample(hi);
    issue = rangeWitness(last);
    if (issue) return issue;
    const bound = contact
      ? undefined
      : await threadClearanceBound(
          bodies,
          ids,
          request,
          lo,
          hi,
          required,
          onProgress,
          cancelled,
        );
    if (bound !== undefined && bound > required)
      return proven(
        bound,
        "Verified with a continuous helical separating surface.",
      );
    type Span = { a: Sample; b: Sample; lower: number };
    const span = (a: Sample, b: Sample): Span => ({
      a,
      b,
      lower: (a.gap + b.gap - speed * (b.v - a.v)) / 2 - tolerance,
    });
    const pending = [span(first, last)];
    let lower = Infinity,
      cursor = 0;
    const budget = Math.max(
      3,
      Math.min(4097, Math.floor(request.maxProbes || 65)),
    );
    while (cursor < pending.length) {
      const interval = pending[cursor++];
      if (interval.lower > required) {
        lower = Math.min(lower, interval.lower);
        continue;
      }
      if (probes >= budget) {
        const floor = Math.max(
          0,
          Math.min(
            lower,
            interval.lower,
            ...pending.slice(cursor).map((s) => s.lower),
          ),
        );
        return result(
          "unresolved",
          (contact ? contact + " " : "") +
            "Full travel unresolved after " +
            probes +
            " poses. " +
            sampled() +
            " Increase the pose budget to refine the remaining intervals.",
          { lowerBound: floor },
        );
      }
      const mid = (interval.a.v + interval.b.v) / 2,
        s = sample(mid);
      issue = rangeWitness(s);
      if (issue) return issue;
      pending.push(span(interval.a, s), span(s, interval.b));
      if (probes === 3 || probes % 4 === 0) {
        onProgress(
          "Checked " +
            probes +
            " poses · " +
            (pending.length - cursor) +
            " intervals pending.",
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    return proven(lower, "");
  } finally {
    solver.delete();
  }
}
