import { evaluate } from "./expressions";

type Kind = "length" | "angle" | "scalar" | "force" | "rate";
export type CamKey =
  | "lift"
  | "radius"
  | "lobes"
  | "rise"
  | "high"
  | "returnAngle"
  | "preload"
  | "rate"
  | "load"
  | "travel"
  | "compression"
  | "pressure";
export type CamSpec = {
  key: CamKey;
  title: string;
  kind: Kind;
  unit: string;
  value: string;
};
export const camFields: CamSpec[] = [
  {
    key: "lift",
    title: "Cam lift",
    kind: "length",
    unit: "mm",
    value: "1.2 mm",
  },
  {
    key: "radius",
    title: "Pitch radius",
    kind: "length",
    unit: "mm",
    value: "4.5 mm",
  },
  {
    key: "lobes",
    title: "Lobes per turn",
    kind: "scalar",
    unit: "",
    value: "4",
  },
  {
    key: "rise",
    title: "Rise angle",
    kind: "angle",
    unit: "°",
    value: "32 deg",
  },
  {
    key: "high",
    title: "High dwell angle",
    kind: "angle",
    unit: "°",
    value: "12 deg",
  },
  {
    key: "returnAngle",
    title: "Return angle",
    kind: "angle",
    unit: "°",
    value: "32 deg",
  },
  {
    key: "preload",
    title: "Spring preload",
    kind: "force",
    unit: "N",
    value: "0.6",
  },
  {
    key: "rate",
    title: "Spring stiffness",
    kind: "rate",
    unit: "N/mm",
    value: "0.7",
  },
  {
    key: "load",
    title: "Additional axial load",
    kind: "force",
    unit: "N",
    value: "0.2",
  },
  {
    key: "travel",
    title: "Follower travel limit",
    kind: "length",
    unit: "mm",
    value: "2.5 mm",
  },
  {
    key: "compression",
    title: "Spring compression limit",
    kind: "length",
    unit: "mm",
    value: "4 mm",
  },
  {
    key: "pressure",
    title: "Pressure angle limit",
    kind: "angle",
    unit: "°",
    value: "45 deg",
  },
];
export type CamExpressions = Record<CamKey, string>;
export type CamInputs = Record<CamKey, number>;
type Event = "Rise" | "High dwell" | "Return" | "Low dwell";
type State =
  | "Contact"
  | "Zero closing force"
  | "Contact unavailable"
  | "Travel exceeded"
  | "Spring limit exceeded";
export type CamSample = {
  theta: number;
  event: Event;
  lift: number;
  slope: number;
  spring: number;
  closing: number;
  compression: number;
  pressure: number;
  normal: number | null;
  torque: number | null;
  state: State;
};
const radians = Math.PI / 180;
const fmt = (v: number, digits = 2) => String(Number(v.toFixed(digits)));
export function camValueOf(
  expr: string,
  kind: Kind,
  values: Record<string, number>,
) {
  if (kind !== "force" && kind !== "rate") return evaluate(expr, values, kind);
  const force: Record<string, number> = {
    N: 1,
    mN: 0.001,
    lbf: 4.4482216152605,
  };
  const length: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };
  const tokens = expr.replace(
    /((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mN|lbf|N)\b(?:\s*\/\s*(mm|cm|in|m)\b)?/gi,
    (_, number: string, f: string, l?: string) => {
      const u = Object.keys(force).find(
        (k) => k.toLowerCase() === f.toLowerCase(),
      )!;
      if ((kind === "rate") !== !!l)
        throw Error(
          kind === "rate"
            ? "Use a spring rate such as 0.7 N/mm."
            : "Use a force such as 0.6 N.",
        );
      return (
        "(" + number + "*" + force[u] / (l ? length[l.toLowerCase()] : 1) + ")"
      );
    },
  );
  return evaluate(tokens, values, "scalar");
}
export function camDefaults(values: Record<string, number>): CamExpressions {
  const expressions = Object.fromEntries(
    camFields.map((f) => [f.key, f.value]),
  ) as CamExpressions;
  if (Object.hasOwn(values, "cam_lift")) expressions.lift = "cam_lift";
  else if (Object.hasOwn(values, "click_stroke"))
    expressions.lift = "click_stroke";
  if (Object.hasOwn(values, "cam_pitch_radius"))
    expressions.radius = "cam_pitch_radius";
  else if (Object.hasOwn(values, "outer_diameter"))
    expressions.radius = "outer_diameter * 3 / 8";
  return expressions;
}
export function evaluateCam(
  expressions: CamExpressions,
  values: Record<string, number>,
): CamInputs {
  const cfg = {} as CamInputs;
  for (const f of camFields) {
    try {
      cfg[f.key] = camValueOf(expressions[f.key], f.kind, values);
      if (!Number.isFinite(cfg[f.key])) throw Error("Enter a finite number.");
    } catch (e) {
      throw Error(
        f.title +
          " — " +
          (e instanceof Error ? e.message : "Check this input."),
      );
    }
  }
  if (!Number.isSafeInteger(cfg.lobes) || cfg.lobes < 1 || cfg.lobes > 360)
    throw Error("Use a whole number of 1 to 360 lobes per turn.");
  if (cfg.lift <= 0 || cfg.radius <= 0)
    throw Error("Lift and pitch radius must be greater than zero.");
  if (cfg.rise <= 0 || cfg.returnAngle <= 0 || cfg.high < 0)
    throw Error(
      "Rise and return angles must be positive. High dwell can be zero.",
    );
  if (cfg.rise + cfg.high + cfg.returnAngle > 360 / cfg.lobes + 1e-8)
    throw Error(
      "Rise, high dwell, and return must fit in the " +
        fmt(360 / cfg.lobes) +
        "° pitch of one lobe.",
    );
  if (cfg.preload < 0 || cfg.rate <= 0)
    throw Error("Use a nonnegative preload and a positive spring stiffness.");
  if (cfg.travel <= 0 || cfg.compression <= 0)
    throw Error("Travel and spring compression limits must be positive.");
  if (cfg.pressure <= 0 || cfg.pressure >= 90)
    throw Error("Choose a pressure angle limit between 0° and 90°.");
  return cfg;
}
export function camPhase(c: CamInputs, theta: number) {
  const pitch = 360 / c.lobes;
  const local = ((theta % pitch) + pitch) % pitch;
  let event: Event = "Low dwell",
    h = 0,
    derivative = 0;
  if (local < c.rise) {
    const u = local / c.rise;
    event = "Rise";
    h = (c.lift * (1 - Math.cos(Math.PI * u))) / 2;
    derivative =
      (c.lift * Math.PI * Math.sin(Math.PI * u)) / (2 * c.rise * radians);
  } else if (local < c.rise + c.high) {
    event = "High dwell";
    h = c.lift;
  } else if (local < c.rise + c.high + c.returnAngle) {
    const u = (local - c.rise - c.high) / c.returnAngle;
    event = "Return";
    h = (c.lift * (1 + Math.cos(Math.PI * u))) / 2;
    derivative =
      (-c.lift * Math.PI * Math.sin(Math.PI * u)) /
      (2 * c.returnAngle * radians);
  }
  return { event, h, derivative };
}
export function camSample(
  c: CamInputs,
  theta: number,
  { axialDisplacement = 0, axialSlope = 0, springEnabled = true } = {},
): CamSample {
  const { event, h, derivative } = camPhase(c, theta),
    stroke = h + axialDisplacement,
    compression = springEnabled ? Math.max(0, c.preload / c.rate + stroke) : 0,
    spring = compression * c.rate,
    closing = spring + c.load;
  const pressure = Math.atan(Math.abs(derivative) / c.radius) / radians;
  const state: State =
    Math.abs(stroke) > c.travel + 1e-9
      ? "Travel exceeded"
      : compression > c.compression + 1e-9
        ? "Spring limit exceeded"
        : closing < -1e-10
          ? "Contact unavailable"
          : Math.abs(closing) <= 1e-10
            ? "Zero closing force"
            : "Contact";
  const ok = state === "Contact" || state === "Zero closing force";
  const normal = ok
    ? Math.max(0, closing) * Math.hypot(1, derivative / c.radius)
    : null;
  const torque = ok ? Math.max(0, closing) * (derivative + axialSlope) : null;
  return {
    theta,
    event,
    lift: h,
    slope: derivative,
    spring,
    closing,
    compression,
    pressure,
    normal,
    torque,
    state,
  };
}
