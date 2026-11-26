// An infinite helicoidal surface stays fixed under a screw displacement of
// matching lead. If two connected solids are on opposite sides, the sum of
// their distances to that surface bounds their separation throughout travel.
import { cast, getOC, makeBox, type AnyShape, type Shape3D } from "replicad";
import { Matrix4, Vector3 } from "three";
import { buildPoses, jointMount, screwLead } from "./kinematics";
import type { ThreadFrame } from "./threadMates";
import { evaluate } from "./expressions";
import type { Probe } from "./clearance";
import { positioned, shapeTolerance } from "./motionGeometry";
import type { Body } from "./geometry";

type Meridian = [phase: number, radius: number][];
type Bounds = [[number, number, number], [number, number, number]];
const tau = 2 * Math.PI;
const modelMargin = 1e-5;
const boundsOf = (shape: Shape3D): Bounds => {
  const box = shape.boundingBox;
  try {
    return box.bounds;
  } finally {
    box.delete();
  }
};

// A quintic Hermite segment matches
// value, tangent and second derivative at both ends. For the sine/cosine
// coordinates its error is <= r*h^6/(64*6!) per coordinate. X is linear.
function separatingSheet(
  profile: Meridian,
  pitch: number,
  base: number,
  minX: number,
  maxX: number,
) {
  const oc = getOC(),
    h = Math.PI / 2;
  // Use complete turns plus one spare at either end; every azimuth and
  // every meridian segment in [minX,maxX] is present in the finite sheet.
  const a = (minX - base) / pitch,
    b = (maxX - base) / pitch,
    first = Math.floor(Math.min(a, b)) - 1,
    last = Math.ceil(Math.max(a, b)) + 1;
  const count = (last - first) * 4;
  if (count > 192) return;
  const knots = new oc.NCollection_Array1_double(1, count + 1),
    mult = new oc.NCollection_Array1_int(1, count + 1);
  const vk = new oc.NCollection_Array1_double(1, 2),
    vm = new oc.NCollection_Array1_int(1, 2);
  const compound = new oc.TopoDS_Compound(),
    builder = new oc.TopoDS_Builder();
  let transferred = false;
  try {
    builder.MakeCompound(compound);
    for (let i = 0; i <= count; i++) {
      knots.SetValue(i + 1, i);
      mult.SetValue(i + 1, i === 0 || i === count ? 6 : 5);
    }
    vk.SetValue(1, 0);
    vk.SetValue(2, 1);
    vm.SetValue(1, 2);
    vm.SetValue(2, 2);
    const coefficients = [
      [0, 0, 0],
      [0, h / 5, 0],
      [0, (2 * h) / 5, (-h * h) / 20],
      [1, (-2 * h) / 5, (-h * h) / 20],
      [1, -h / 5, 0],
      [1, 0, 0],
    ];
    for (let strip = 1; strip < profile.length; strip++) {
      const poles = new oc.NCollection_Array2_gp_Pnt(1, 5 * count + 1, 1, 2);
      try {
        for (let j = 0; j < 2; j++) {
          const [s, r] = profile[strip + j - 1];
          for (let i = 0; i < count; i++) {
            for (let k = 0; k < 6; k++) {
              const [end, v, acceleration] = coefficients[k];
              const angle = tau * first + (i + end) * h,
                sine = Math.sin(angle),
                cosine = Math.cos(angle);
              const point = new oc.gp_Pnt(
                base + s + (pitch * (angle + v)) / tau,
                r * ((1 + acceleration) * sine + v * cosine),
                r * (-(1 + acceleration) * cosine + v * sine),
              );
              try {
                poles.SetValue(i * 5 + k + 1, j + 1, point);
              } finally {
                point.delete();
              }
            }
          }
        }
        const surface = new oc.Geom_BSplineSurface(
          poles,
          knots,
          vk,
          mult,
          vm,
          5,
          1,
          false,
          false,
        );
        try {
          const face = new oc.BRepBuilderAPI_MakeFace(surface, 1e-7);
          try {
            if (!face.IsDone()) return;
            const f = face.Face();
            try {
              builder.Add(compound, f);
            } finally {
              f.delete();
            }
          } finally {
            face.delete();
          }
        } finally {
          surface.delete();
        }
      } finally {
        poles.delete();
      }
    }
    const radius = Math.max(...profile.map((p) => p[1]));
    const shape = cast(compound);
    transferred = true;
    return { shape, error: (Math.SQRT2 * radius * h ** 6) / (64 * 720) };
  } finally {
    if (!transferred) compound.delete();
    builder.delete();
    knots.delete();
    mult.delete();
    vk.delete();
    vm.delete();
  }
}
function clip(shape: Shape3D, b: Bounds, xmin: number, xmax: number) {
  const tool = makeBox(
    [xmin, b[0][1] - 1, b[0][2] - 1],
    [xmax, b[1][1] + 1, b[1][2] + 1],
  );
  try {
    return shape.intersect(tool);
  } finally {
    tool.delete();
  }
}
function signedRadius(
  point: number[],
  profile: Meridian,
  pitch: number,
  base: number,
) {
  const [x, y, z] = point,
    angle = Math.atan2(y, -z),
    period = Math.abs(pitch);
  let phase = x - base - (angle * pitch) / tau;
  phase -= Math.floor(phase / period + 0.5) * period;
  const i = profile.findIndex((part, i) => i > 0 && phase <= part[0]);
  if (i < 1) return NaN;
  const [a, ra] = profile[i - 1],
    [b, rb] = profile[i];
  return Math.hypot(y, z) - (ra + ((rb - ra) * (phase - a)) / (b - a));
}
function sidedDistance(
  body: Shape3D,
  sheet: AnyShape,
  profile: Meridian,
  pitch: number,
  base: number,
  inside: boolean,
) {
  const oc = getOC(),
    solids = body.solids;
  try {
    if (!solids.length) return;
    let min = Infinity;
    for (const solid of solids) {
      const explorer = new oc.TopExp_Explorer(
        solid.wrapped,
        oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      try {
        if (!explorer.More()) return;
        const current = explorer.Current();
        try {
          const vertex = oc.TopoDS.Vertex(current);
          try {
            const pt = oc.BRep_Tool.Pnt(vertex);
            try {
              const signed = signedRadius(
                [pt.X(), pt.Y(), pt.Z()],
                profile,
                pitch,
                base,
              );
              if (
                !Number.isFinite(signed) ||
                (inside ? signed >= -modelMargin : signed <= modelMargin)
              )
                return;
            } finally {
              pt.delete();
            }
          } finally {
            vertex.delete();
          }
        } finally {
          current.delete();
        }
      } finally {
        explorer.delete();
      }
      const d = new oc.BRepExtrema_DistShapeShape();
      try {
        d.SetDeflection(1e-7);
        d.LoadS1(solid.wrapped);
        d.LoadS2(sheet.wrapped);
        if (!d.Perform() || !d.IsDone()) return;
        const gap = d.Value();
        if (!Number.isFinite(gap) || gap <= modelMargin) return;
        min = Math.min(min, gap);
      } finally {
        d.delete();
      }
    }
    return min;
  } finally {
    solids.forEach((s) => s.delete());
  }
}
const verified = new WeakMap<Body, Map<string, number>>();
export async function threadClearanceBound(
  bodies: Body[],
  ids: string[],
  req: Probe,
  lo: number,
  hi: number,
  required: number,
  progress: (message: string) => void,
  cancelled: () => boolean,
): Promise<number | undefined> {
  const { id, pair, config, values } = req,
    j = config[id];
  if (!j || j.kind !== "screw" || j.parent !== pair || req.coordinate !== 0)
    return;
  const ai = ids.indexOf(id),
    bi = ids.indexOf(pair);
  // Use the physical marks to choose a candidate separator. All clearance,
  // connectivity, and sidedness tests below use the current post-machining B-reps.
  const modeled = (body: Body, side: ThreadFrame["side"]) =>
    body.threadFrames?.filter((f) => f.mode === "modeled" && f.side === side);
  const males = modeled(bodies[bi], "external"),
    females = modeled(bodies[ai], "internal");
  if (males?.length !== 1 || females?.length !== 1) return;
  const male = males[0],
    female = females[0],
    p = male.pitch,
    signedPitch = p * (male.hand === "right" ? 1 : -1);
  if (
    !(p > 0 && male.length > 0 && female.diameter > male.diameter) ||
    male.hand !== female.hand ||
    Math.abs(female.pitch - p) > 1e-7
  )
    return;
  const radius = male.diameter / 2,
    minor = radius - (5 * Math.sqrt(3) * p) / 16;
  if (minor <= 0) return;
  const mount = jointMount(j, values);
  const toAxis = (
    male.axis === "Z" ? new Matrix4().makeRotationY(Math.PI / 2) : new Matrix4()
  ).multiply(
    new Matrix4().makeTranslation(
      ...(male.entrance.map((x) => -x) as [number, number, number]),
    ),
  );
  const frame = toAxis.clone().multiply(mount);
  const spin = new Vector3(
    j.axis === "X" ? 1 : 0,
    j.axis === "Y" ? 1 : 0,
    j.axis === "Z" ? 1 : 0,
  ).transformDirection(frame);
  const sign = spin.x < 0 ? -1 : 1;
  const directionError = spin.distanceTo(new Vector3(sign, 0, 0));
  const pivot = new Vector3(
    ...(j.origin.map(
      (s, i) => evaluate(s, values) + evaluate(j.offset[i], values),
    ) as [number, number, number]),
  ).applyMatrix4(frame);
  const eccentricity = Math.hypot(pivot.y, pivot.z),
    lead = screwLead(j, values);
  if (
    eccentricity > 1e-5 ||
    directionError > 1e-8 ||
    Math.abs(lead - signedPitch) > 1e-7
  )
    return;

  const drivers = { ...req.drivers, [id]: [lo] };
  const poses = buildPoses(ids, config, drivers, values);
  const transforms = toAxis
    .clone()
    .multiply(new Matrix4().fromArray(poses[bi]).invert())
    .multiply(new Matrix4().fromArray(poses[ai]));
  const key = JSON.stringify([
    pair,
    lo,
    hi,
    required,
    transforms.toArray(),
    frame.toArray(),
    pivot.toArray(),
    j.axis,
    lead,
  ]);
  const stored = verified.get(bodies[ai])?.get(key);
  if (stored !== undefined) return stored;
  const pause = async (text: string) => {
    progress(text);
    await new Promise<void>((r) => setTimeout(r, 0));
    if (cancelled()) throw Error("Clearance check canceled.");
  };
  const alive: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(object: T) => {
    alive.push(object);
    return object;
  };
  try {
    await pause("Checking the thread geometry over the full screw travel…");
    const cap = keep(positioned(bodies[ai].shape, transforms.toArray())),
      barrel = keep(positioned(bodies[bi].shape, toAxis.toArray()));
    const cb = boundsOf(cap),
      bb = boundsOf(barrel);
    const radians = ((hi - lo) * Math.PI) / 180,
      shift = ((hi - lo) * sign * signedPitch) / 360;
    const reach = Math.hypot(
      ...[pivot.x, pivot.y, pivot.z].map((c, i) =>
        Math.max(Math.abs(cb[0][i] - c), Math.abs(cb[1][i] - c)),
      ),
    );
    const motionError =
      2 * eccentricity +
      directionError * (radians * reach + Math.abs(shift)) +
      (Math.abs(lead - signedPitch) * (hi - lo)) / 360 +
      modelMargin;
    const guard = Math.max(required + motionError + p / 8, 0.1 * p);
    // Any closer pair must inhabit both clipped X slabs. These slabs include
    // material outside the threaded lengths (end shoulders, pilots or closed caps).
    const amin = Math.max(
      cb[0][0] - modelMargin,
      bb[0][0] - Math.max(0, shift) - guard,
    );
    const amax = Math.min(
      cb[1][0] + modelMargin,
      bb[1][0] - Math.min(0, shift) + guard,
    );
    const bmin = Math.max(
      bb[0][0] - modelMargin,
      cb[0][0] + Math.min(0, shift) - guard,
    );
    const bmax = Math.min(
      bb[1][0] + modelMargin,
      cb[1][0] + Math.max(0, shift) + guard,
    );
    if (amin >= amax || bmin >= bmax)
      return guard - motionError - shapeTolerance(cap) - shapeTolerance(barrel);
    const shiftR = (female.diameter - male.diameter) / 4;
    const profile: Meridian = [
      [-p / 2, radius + shiftR],
      [(-7 * p) / 16, radius + shiftR],
      [-p / 8, minor + shiftR],
      [p / 8, minor + shiftR],
      [(7 * p) / 16, radius + shiftR],
      [p / 2, radius + shiftR],
    ];
    const base = (male.end === "start" ? 0 : -male.length) - p / 2;
    const a = keep(clip(cap, cb, amin, amax)),
      b = keep(clip(barrel, bb, bmin, bmax));
    const sheet = separatingSheet(
      profile,
      signedPitch,
      base,
      Math.min(amin, bmin) - guard,
      Math.max(amax, bmax) + guard,
    );
    if (!sheet) return;
    keep(sheet.shape);
    const numericMargin = modelMargin + shapeTolerance(sheet.shape);
    const capMargin =
      numericMargin + Math.max(shapeTolerance(a), shapeTolerance(cap));
    const barrelMargin =
      numericMargin + Math.max(shapeTolerance(b), shapeTolerance(barrel));
    await pause(
      "Measuring the internal thread against the separating surface…",
    );
    const capGap = sidedDistance(
      a,
      sheet.shape,
      profile,
      signedPitch,
      base,
      false,
    );
    if (capGap === undefined || capGap <= sheet.error + capMargin) return;
    await pause(
      "Measuring the external thread against the separating surface…",
    );
    const barrelGap = sidedDistance(
      b,
      sheet.shape,
      profile,
      signedPitch,
      base,
      true,
    );
    if (barrelGap === undefined || barrelGap <= sheet.error + barrelMargin)
      return;
    // All components of both crops are disjoint from the true, continuous
    // graph. Opposite signs force every connecting line to cross the graph.
    const floor = Math.max(
      0,
      Math.min(
        guard,
        Math.min(guard, capGap) +
          Math.min(guard, barrelGap) -
          2 * sheet.error -
          capMargin -
          barrelMargin,
      ) - motionError,
    );
    const cache = verified.get(bodies[ai]) || new Map<string, number>();
    if (cache.size >= 32) cache.clear();
    cache.set(key, floor);
    verified.set(bodies[ai], cache);
    return floor;
  } catch {
    // An unsuitable separator or a rejected surface never certifies a pair.
    return;
  } finally {
    alive.reverse().forEach((x) => x.delete());
  }
}
