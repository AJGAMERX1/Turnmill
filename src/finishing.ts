import {
  genericSweep,
  makeCylinder,
  makeHelix,
  makePolygon,
  measureVolume,
  type Shape3D,
  type Edge,
} from "replicad";
import { cutHole } from "./holeMachining";
import { applyKnurl, applyMark } from "./surfaceFinishes";
import type { EvaluatedFinish } from "./finishingTypes";
import type { ThreadFrame } from "./threadMates";
type Vec = [number, number, number];
type Axis = "revolve" | "extrude";
type Thread = Extract<EvaluatedFinish, { kind: "thread" }>;

function bounds(shape: Shape3D | Edge) {
  const box = shape.boundingBox;
  try {
    return box.bounds;
  } finally {
    box.delete();
  }
}

function axialFrame(shape: Shape3D, kind: Axis, end: "start" | "end") {
  const [lo, hi] = bounds(shape),
    turning = kind === "revolve",
    axis = turning ? 0 : 2;
  const endCoord = end === "start" ? lo[axis] : hi[axis];
  const center: Vec = turning
    ? [0, 0, 0]
    : [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0];
  const radialBound = turning
    ? Math.max(
        Math.abs(lo[1]),
        Math.abs(lo[2]),
        Math.abs(hi[1]),
        Math.abs(hi[2]),
      )
    : Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
  return { axis, center, endCoord, span: hi[axis] - lo[axis], radialBound };
}

function cylinder(
  radius: number,
  length: number,
  start: number,
  center: Vec,
  axis: number,
) {
  const base: Vec = [...center];
  base[axis] = start;
  return makeCylinder(radius, length, base, axis === 0 ? [1, 0, 0] : [0, 0, 1]);
}

function finishEdges(
  shape: Shape3D,
  kind: Axis,
  f: Extract<EvaluatedFinish, { kind: "fillet" | "chamfer" }>,
) {
  const frame = axialFrame(shape, kind, f.end);
  const edges = shape.edges;
  const matches = edges.filter((edge) => {
    const [lo, hi] = bounds(edge);
    return (
      Math.abs(lo[frame.axis] - frame.endCoord) < 0.00005 &&
      Math.abs(hi[frame.axis] - frame.endCoord) < 0.00005
    );
  });
  let selected = matches;
  if (kind === "revolve" && f.rims !== "all") {
    const rings = matches.filter((e) => e.geomType === "CIRCLE");
    const lengths = rings.map((e) => e.length);
    const pick =
      f.rims === "outer" ? Math.max(...lengths) : Math.min(...lengths);
    selected =
      f.rims === "inner" && lengths.length < 2
        ? []
        : rings.filter((e) => Math.abs(e.length - pick) < 0.00005);
  }
  if (!selected.length) {
    edges.forEach((edge) => edge.delete());
    throw Error(
      "No matching rim exists at this end. Choose another end or rim.",
    );
  }
  const chosen = new Set(selected);
  edges.filter((e) => !chosen.has(e)).forEach((edge) => edge.delete());
  return f.kind === "fillet"
    ? shape.fillet(f.size, (finder) => finder.inList(selected))
    : shape.chamfer(f.size, (finder) => finder.inList(selected));
}

function applyThread(
  shape: Shape3D,
  f: Thread,
  frame: ReturnType<typeof axialFrame>,
) {
  const { axis, center } = frame;
  if (f.length > frame.span + 1e-5)
    throw Error("Shorten the thread to fit within the body.");
  const z = f.end === "start" ? frame.endCoord : frame.endCoord - f.length;
  const r = f.diameter / 2,
    p = f.pitch,
    h = f.length,
    depth = (5 * Math.sqrt(3) * p) / 16,
    minor = r - depth;
  const internal = f.side === "internal";
  const clearance = 0.02 * p;
  // Verify a ring of material over the usable length, allowing an entry chamfer at either end.
  const inset = Math.min(p, h * 0.22),
    witnessRadius = internal ? minor + 0.06 * p : r - 0.06 * p;
  if (witnessRadius <= 0.02 * p)
    throw Error("Increase the thread diameter or reduce the pitch.");
  const witnessOuter = cylinder(
    witnessRadius,
    h - 2 * inset,
    z + inset,
    center,
    axis,
  );
  const witnessInner = cylinder(
    witnessRadius - 0.02 * p,
    h - 2 * inset,
    z + inset,
    center,
    axis,
  );
  const witness = witnessOuter.cut(witnessInner);
  witnessOuter.delete();
  witnessInner.delete();
  const material = shape.intersect(witness);
  const available = measureVolume(material),
    expected = measureVolume(witness);
  material.delete();
  witness.delete();
  if (available < expected * 0.999)
    throw Error(
      internal
        ? "The bore is too large or the wall is too thin for this thread. Use a larger thread or reduce the bore."
        : "There is insufficient stock around the axis. Reduce the major diameter or shorten the threaded band.",
    );
  if (f.mode === "cosmetic") {
    const count = Math.max(40, Math.ceil((h / p) * 48)),
      coords = new Float32Array(count * 6);
    const radius = internal ? minor : r;
    const point = (i: number): Vec => {
      const t = i / count,
        a = (((f.hand === "left" ? -1 : 1) * 2 * Math.PI * h) / p) * t;
      return axis === 0
        ? [
            z + t * h,
            center[1] + radius * Math.sin(a),
            center[2] - radius * Math.cos(a),
          ]
        : [
            center[0] + radius * Math.cos(a),
            center[1] + radius * Math.sin(a),
            z + t * h,
          ];
    };
    for (let i = 0; i < count; i++) {
      coords.set(point(i), i * 6);
      coords.set(point(i + 1), i * 6 + 3);
    }
    return { shape: shape.clone(), guides: coords };
  }
  // Build on the local Z axis then map the helix rigidly onto the feature axis.
  const halfWide = internal ? (3 * p) / 8 : (7 * p) / 16,
    halfNarrow = internal ? p / 16 : p / 8;
  const wide = internal ? minor - clearance : r + clearance,
    narrow = internal ? r : minor;
  const a = halfWide + clearance / Math.sqrt(3),
    b = halfNarrow;
  const face = makePolygon([
    [wide, 0, -a],
    [narrow, 0, -b],
    [narrow, 0, b],
    [wide, 0, a],
  ]);
  const section = face.outerWire();
  face.delete();
  const helix = makeHelix(
    p,
    h + p,
    (wide + narrow) / 2,
    [0, 0, 0],
    [0, 0, 1],
    f.hand === "left",
  );
  let cutter: Shape3D | undefined,
    band: Shape3D | undefined,
    prepared: Shape3D | undefined,
    sweep: Shape3D | undefined;
  try {
    sweep = genericSweep(section, helix, { frenet: true });
    sweep = sweep.translate([0, 0, -p / 2]);
    if (axis === 0) sweep = sweep.rotate(90, [0, 0, 0], [0, 1, 0]);
    const offset: Vec = [...center];
    offset[axis] = z;
    sweep = sweep.translate(offset);
    band = cylinder(Math.max(r, p) + clearance * 3, h, z, center, axis);
    cutter = sweep.intersect(band);
    if (internal) {
      const pilot = cylinder(minor, h, z, center, axis);
      try {
        prepared = shape.cut(pilot);
      } finally {
        pilot.delete();
      }
    } else {
      const outside = cylinder(
        Math.max(frame.radialBound * 2, r * 2) + 1,
        h,
        z,
        center,
        axis,
      );
      const blank = cylinder(r, h, z, center, axis),
        trim = outside.cut(blank);
      try {
        prepared = shape.cut(trim);
      } finally {
        outside.delete();
        blank.delete();
        trim.delete();
      }
    }
    const before = measureVolume(prepared),
      minChange = 1e-8;
    let result = prepared.cut(cutter);
    if (before - measureVolume(result) > minChange) return { shape: result };
    // Periodic faces can defeat OCCT's classification of a long tool. Partition the
    // same helix at pitch boundaries, keeping its phase, depth and axial limits.
    result.delete();
    result = prepared.clone();
    try {
      for (let i = 0; i < Math.ceil(h / p); i++) {
        const reach = Math.min(p, h - i * p);
        if (reach < 1e-7) continue;
        const bandSlice = cylinder(
          r + clearance * 3,
          reach,
          z + i * p,
          center,
          axis,
        );
        let section: Shape3D | undefined;
        try {
          section = cutter.intersect(bandSlice);
          const next = result.cut(section);
          if (measureVolume(next) > measureVolume(result) + minChange) {
            next.delete();
            throw Error(
              "A thread turn could not be cut. Check the thread length and stock diameter.",
            );
          }
          result.delete();
          result = next;
        } finally {
          bandSlice.delete();
          section?.delete();
        }
      }
      if (before - measureVolume(result) <= minChange)
        throw Error(
          "The helix misses the material. Check the nominal diameter and the selected end.",
        );
      return { shape: result };
    } catch (error) {
      result.delete();
      throw error;
    }
  } finally {
    section.delete();
    helix.delete();
    sweep?.delete();
    band?.delete();
    cutter?.delete();
    prepared?.delete();
  }
}

export function applyFinish(
  shape: Shape3D,
  kind: Axis,
  finish: EvaluatedFinish,
): {
  shape: Shape3D;
  guides?: Float32Array;
  thread?: Omit<ThreadFrame, "featureId" | "bodyId">;
} {
  if (finish.kind === "knurl")
    return { shape: applyKnurl(shape, finish, kind) };
  if (finish.kind === "mark") return { shape: applyMark(shape, finish, kind) };
  if (finish.kind === "fillet" || finish.kind === "chamfer")
    return { shape: finishEdges(shape, kind, finish) };
  if (finish.kind === "thread") {
    const frame = axialFrame(shape, kind, finish.end);
    const entrance: Vec = [...frame.center];
    entrance[frame.axis] = frame.endCoord;
    return {
      ...applyThread(shape, finish, frame),
      thread: {
        finishId: finish.id,
        name: finish.name,
        axis: frame.axis === 0 ? "X" : "Z",
        entrance,
        end: finish.end,
        side: finish.side,
        hand: finish.hand,
        mode: finish.mode,
        pitch: finish.pitch,
        diameter: finish.diameter,
        length: finish.length,
      },
    };
  }
  if (finish.kind !== "hole")
    throw Error("Choose a supported finishing operation.");
  return { shape: cutHole(shape, kind === "revolve", finish) };
}
