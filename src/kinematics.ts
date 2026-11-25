import { Matrix4, Vector3, Quaternion } from "three";
import type { EvaluatedFeature } from "./types";
import { evaluate } from "./expressions";
import { springReading, type CompressionSpring } from "./springForce";
import {
  evaluateCam,
  camSample,
  type CamExpressions,
  type CamSample,
} from "./camLaw";
export const jointKinds = [
  "fixed",
  "revolute",
  "slider",
  "cylindrical",
  "ball",
  "planar",
  "screw",
] as const;
export type JointKind = (typeof jointKinds)[number];
export type CamLink = {
  driver: string;
  law: CamExpressions;
  datum: string;
  phase: string;
  direction: 1 | -1;
  springEnabled: boolean;
};
export type Joint = {
  kind: JointKind;
  parent: string;
  axis: "X" | "Y" | "Z";
  origin: [string, string, string];
  offset: [string, string, string];
  min: string;
  max: string;
  pitch: string;
  starts: string;
  hand: 1 | -1;
  bounds?: Record<string, [string, string]>;
  cam?: CamLink;
  spring?: CompressionSpring;
  threadMate?: import("./threadMates").ThreadMate;
  mount?: number[];
};
export type Driver = { active: number; coords: number[] };
export type JointConfig = Record<string, Joint>;
export const defaultJoint = (): Joint => ({
  kind: "fixed",
  parent: "",
  axis: "X",
  origin: ["0", "0", "0"],
  offset: ["0", "0", "0"],
  min: "0",
  max: "360",
  pitch: "0.75 mm",
  starts: "1",
  hand: 1,
});
export function specs(
  kind: JointKind,
): { label: string; unit: "angle" | "length"; axis: 0 | 1 | 2 }[] {
  switch (kind) {
    case "fixed":
      return [];
    case "revolute":
    case "screw":
      return [{ label: "Rotation", unit: "angle", axis: 0 }];
    case "slider":
      return [{ label: "Position", unit: "length", axis: 0 }];
    case "cylindrical":
      return [
        { label: "Translation", unit: "length", axis: 0 },
        { label: "Rotation", unit: "angle", axis: 0 },
      ];
    case "ball":
      return [
        { label: "Roll", unit: "angle", axis: 0 },
        { label: "Pitch", unit: "angle", axis: 1 },
        { label: "Yaw", unit: "angle", axis: 2 },
      ];
    case "planar":
      return [
        { label: "In-plane U", unit: "length", axis: 1 },
        { label: "In-plane V", unit: "length", axis: 2 },
        { label: "Rotation", unit: "angle", axis: 0 },
      ];
  }
}
export function limits(
  j: Joint,
  k: number,
  values: Record<string, number>,
): [number, number] {
  const u = specs(j.kind)[k]?.unit;
  if (!u) return [0, 0];
  const range =
    k === 0
      ? [j.min, j.max]
      : j.bounds?.[k] ||
        (u === "angle" ? ["-180 deg", "180 deg"] : ["-25 mm", "25 mm"]);
  const min = evaluate(range[0], values, u),
    max = evaluate(range[1], values, u);
  if (min >= max) throw Error("Set the maximum joint limit above its minimum.");
  return [min, max];
}
export function screwLead(j: Joint, values: Record<string, number>) {
  const starts = evaluate(j.starts, values, "scalar"),
    pitch = evaluate(j.pitch, values);
  if (!Number.isInteger(starts) || starts < 1 || pitch <= 0)
    throw Error("Use a positive pitch and a whole number of thread starts.");
  return pitch * starts * j.hand;
}
export function bodyIds(features: EvaluatedFeature[]) {
  return features.filter((f) => f.operation === "new").map((f) => f.id);
}
export type CamReading = {
  followerId: string;
  driverId: string;
  rotation: number;
  position: number;
  sample: CamSample;
  springEnabled: boolean;
  error: string;
};
export function camDriverRotation(driver: Joint) {
  if (driver.kind === "cylindrical") return 1;
  if (driver.kind === "revolute" || driver.kind === "screw") return 0;
  throw Error(
    "Choose a revolute, cylindrical, or screw joint to rotate the cam.",
  );
}
export function camTravelSpeed(
  follower: Joint,
  driver: Joint,
  coordinate: number,
  values: Record<string, number>,
) {
  const link = follower.cam;
  if (!link) return 0;
  const angular = camDriverRotation(driver);
  if (coordinate !== angular)
    return driver.kind === "cylindrical" && coordinate === 0 ? 1 : 0;
  const c = evaluateCam(link.law, values);
  const leadPerDegree =
    driver.kind === "screw" ? Math.abs(screwLead(driver, values)) / 360 : 0;
  return (
    (c.lift * Math.PI) / (2 * Math.min(c.rise, c.returnAngle)) + leadPerDegree
  );
}
export function assemblyCamReadings(
  ids: string[],
  config: JointConfig,
  drivers: Record<string, number[]>,
  values: Record<string, number>,
): CamReading[] {
  const readings: CamReading[] = [];
  for (const followerId of ids) {
    const follower = config[followerId],
      link = follower?.cam;
    if (!link) continue;
    const driver = config[link.driver];
    if (follower.kind !== "slider")
      throw Error(
        "Restore the follower's slider joint or unlink its cam in Cam & spring.",
      );
    if (!ids.includes(link.driver) || !driver)
      throw Error(
        "The cam driver is missing. Restore its body or unlink it in Cam & spring.",
      );
    const inParent = (joint: Joint) => {
      const axis = new Vector3().setComponent(
        { X: 0, Y: 1, Z: 2 }[joint.axis],
        1,
      );
      return joint.mount
        ? axis.transformDirection(new Matrix4().fromArray(joint.mount))
        : axis;
    };
    if (
      driver.parent !== follower.parent ||
      inParent(driver).dot(inParent(follower)) < 1 - 1e-10
    )
      throw Error(
        "Set the cam and slider to the same joint axis and parent, or unlink them in Cam & spring.",
      );
    if (link.direction !== 1 && link.direction !== -1)
      throw Error("Choose a positive or negative direction for cam lift.");
    const angular = camDriverRotation(driver);
    const inputs = drivers[link.driver] || [];
    function input(i: number) {
      const [min, max] = limits(driver, i, values);
      const raw = inputs[i] ?? 0;
      if (!Number.isFinite(raw))
        throw Error("Enter a finite cam driver position.");
      return Math.max(min, Math.min(max, raw));
    }
    const rotation = input(angular);
    const lead = driver.kind === "screw" ? screwLead(driver, values) : 0;
    const advance =
      driver.kind === "cylindrical" ? input(0) : (rotation * lead) / 360;
    const law = evaluateCam(link.law, values);
    const sample = camSample(
      law,
      rotation + evaluate(link.phase, values, "angle"),
      {
        axialDisplacement: advance * link.direction,
        axialSlope: (lead * link.direction) / (2 * Math.PI),
        springEnabled: link.springEnabled,
      },
    );
    const position =
      evaluate(link.datum, values) + advance + link.direction * sample.lift;
    const [low, high] = limits(follower, 0, values);
    let error = "";
    if (position < low - 1e-9 || position > high + 1e-9)
      error = `The cam requires ${Number(position.toFixed(4))} mm of slider position, outside ${low} to ${high} mm. Adjust the slider limits, follower zero, or cam lift.`;
    else if (sample.state === "Travel exceeded")
      error =
        "The cam exceeds the follower travel limit. Increase travel or reduce lift or axial advance.";
    else if (sample.state === "Spring limit exceeded")
      error =
        "The cam compresses the spring past its limit. Reduce lift or preload, or change the spring.";
    else if (sample.state === "Contact unavailable")
      error =
        "The follower loses contact at this rotation. Increase closing load or spring preload.";
    readings.push({
      followerId,
      driverId: link.driver,
      rotation,
      position,
      sample,
      springEnabled: link.springEnabled,
      error,
    });
  }
  return readings;
}
// On each harmonic rise or return, follower position is a half cosine plus
// the driver's linear advance. The spring and travel constraints depend on
// that position. Within a lobe it suffices to check endpoints and stationary
// positions. Equivalent positions on successive lobes differ by a fixed lead.
export function jointTravelProblem(
  ids: string[],
  config: JointConfig,
  drivers: Record<string, number[]>,
  values: Record<string, number>,
  driverId: string,
  coordinate: number,
): string {
  const moving = config[driverId];
  if (
    moving?.kind === "slider" &&
    moving.spring &&
    !moving.cam &&
    coordinate === 0
  ) {
    const [lo, hi] = limits(moving, 0, values);
    const compressedEnd = moving.spring.direction === -1 ? lo : hi;
    const issue = springReading(moving.spring, compressedEnd, values).error;
    if (issue)
      return `Slider travel is infeasible at ${Number(compressedEnd.toFixed(5))} mm. ${issue}`;
  }
  const followers = ids.filter((id) => config[id]?.cam?.driver === driverId);
  if (!followers.length) return "";
  const driver = config[driverId],
    angular = camDriverRotation(driver);
  const [lo, hi] = limits(driver, coordinate, values);
  for (const followerId of followers) {
    const link = config[followerId].cam!;
    const candidates = new Set([lo, hi]);
    if (coordinate === angular) {
      const c = evaluateCam(link.law, values),
        pitch = 360 / c.lobes;
      const offset = evaluate(link.phase, values, "angle");
      const lead =
        driver.kind === "screw" ? screwLead(driver, values) / 360 : 0;
      const phases = [
        0,
        c.rise,
        c.rise + c.high,
        c.rise + c.high + c.returnAngle,
      ];
      for (const [start, span, sign] of [
        [0, c.rise, 1],
        [c.rise + c.high, c.returnAngle, -1],
      ]) {
        const peakSlope =
          (link.direction * sign * c.lift * Math.PI) / (2 * span);
        const sine = -lead / peakSlope;
        if (sine > 0 && sine <= 1) {
          const fraction = Math.asin(sine) / Math.PI;
          phases.push(start + span * fraction, start + span * (1 - fraction));
        }
      }
      for (const phase of phases) {
        const base = phase - offset;
        for (const turn of [
          Math.ceil((lo - base) / pitch),
          Math.floor((hi - base) / pitch),
        ]) {
          const angle = base + turn * pitch;
          if (angle > lo && angle < hi) candidates.add(angle);
        }
      }
    }
    for (const pos of candidates) {
      const coords = [...(drivers[driverId] || [])];
      coords[coordinate] = pos;
      const reading = assemblyCamReadings(
        ids,
        config,
        { ...drivers, [driverId]: coords },
        values,
      ).find((r) => r.followerId === followerId)!;
      if (reading.error)
        return `Cam travel is infeasible at ${Number(pos.toFixed(5))}${coordinate === angular ? "°" : " mm"}. ${reading.error}`;
    }
  }
  return "";
}
export function buildPoses(
  ids: string[],
  config: JointConfig,
  drivers: Record<string, number[]>,
  values: Record<string, number>,
) {
  const driven = new Map<string, number>();
  for (const reading of assemblyCamReadings(ids, config, drivers, values)) {
    if (reading.error) throw Error(reading.error);
    driven.set(reading.followerId, reading.position);
  }
  const poses = new Map<string, Matrix4>(),
    active = new Set<string>();
  function pose(id: string): Matrix4 {
    if (poses.has(id)) return poses.get(id)!;
    if (active.has(id))
      throw Error(
        "The joint parents form a loop. Attach one component to Ground.",
      );
    active.add(id);
    const j = config[id] || defaultJoint(),
      shift = j.offset.map((s) => evaluate(s, values)) as [
        number,
        number,
        number,
      ],
      origin = j.origin.map((s) => evaluate(s, values)) as [
        number,
        number,
        number,
      ];
    const axisIndex = { X: 0, Y: 1, Z: 2 }[j.axis];
    const axes = [0, 1, 2].map((i) =>
      new Vector3().setComponent((i + axisIndex) % 3, 1),
    );
    const displacement = new Vector3(...shift),
      rotation = new Quaternion();
    specs(j.kind).forEach((spec, i) => {
      const [min, max] = limits(j, i, values),
        value =
          driven.get(id) ?? Math.min(max, Math.max(min, drivers[id]?.[i] ?? 0));
      if (j.kind === "slider" && j.spring && !j.cam) {
        const issue = springReading(j.spring, value, values).error;
        if (issue) throw Error(issue);
      }
      if (spec.unit === "angle")
        rotation.multiply(
          new Quaternion().setFromAxisAngle(
            axes[spec.axis],
            (value * Math.PI) / 180,
          ),
        );
      else displacement.addScaledVector(axes[spec.axis], value);
      if (j.kind === "screw")
        displacement.addScaledVector(
          axes[0],
          (value * screwLead(j, values)) / 360,
        );
    });
    const mat = new Matrix4()
      .makeTranslation(displacement.x, displacement.y, displacement.z)
      .multiply(new Matrix4().makeTranslation(...origin))
      .multiply(new Matrix4().makeRotationFromQuaternion(rotation))
      .multiply(
        new Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]),
      );
    if (j.mount) mat.premultiply(new Matrix4().fromArray(j.mount));
    if (j.parent) {
      if (!ids.includes(j.parent))
        throw Error(
          "A joint parent is suppressed or missing. Select a new parent or restore the component.",
        );
      mat.premultiply(pose(j.parent));
    }
    active.delete(id);
    poses.set(id, mat);
    return mat;
  }
  return ids.map((id) => pose(id).toArray());
}
