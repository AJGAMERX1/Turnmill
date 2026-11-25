import {
  assembleWire,
  genericSweep,
  getOC,
  loft,
  makeFace,
  makeLine,
  makeThreePointArc,
  measureShapeVolumeProperties,
  type AnyShape,
  type Edge,
  type Shape3D,
  type Wire,
} from "replicad";
import type { SolvedEdge, XY } from "./solveSketch";

type Mode = "add" | "cut" | "replace";
type Coord = [number, number, number];
type Placement = (p: XY) => Coord;

export type EvaluatedProfileAdvanced =
  | {
      kind: "loft";
      mode: Mode;
      lower: SolvedEdge[];
      upper: SolvedEdge[];
      z1: number;
      z2: number;
    }
  | {
      kind: "sweep";
      mode: Mode;
      section: SolvedEdge[];
      path: SolvedEdge[];
      z: number;
      anchor?: XY;
    };

const tolerance = 1e-7;
const close = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const finite = (p: XY) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const flat =
  (z: number): Placement =>
  (p) => [p.x, p.y, z];

function checkValid(shape: AnyShape, message: string) {
  const checker = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true);
  try {
    if (!checker.IsValid()) throw Error(message);
  } finally {
    checker.delete();
  }
}

function wire(
  edges: SolvedEdge[],
  placement: Placement,
  closed: boolean,
  label: string,
): Wire {
  if (!Array.isArray(edges) || !edges.length)
    throw Error(label + " needs an ordered run of edges.");
  const curves: Edge[] = [];
  try {
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (
        !e ||
        !finite(e.start) ||
        !finite(e.end) ||
        (e.through && !finite(e.through))
      )
        throw Error(label + " has an invalid coordinate.");
      if (i && !close(edges[i - 1].end, e.start))
        throw Error(
          label + " has disconnected edges. Select a continuous run in order.",
        );
      if (close(e.start, e.end))
        throw Error(label + " contains a collapsed edge.");
      curves.push(
        e.through
          ? makeThreePointArc(
              placement(e.start),
              placement(e.through),
              placement(e.end),
            )
          : makeLine(placement(e.start), placement(e.end)),
      );
    }
    if (close(edges[0].start, edges.at(-1)!.end) !== closed)
      throw Error(
        closed
          ? label + " must form a closed contour."
          : "The sweep path must be open. Select a shorter run of connected edges.",
      );
    const result = assembleWire(curves);
    try {
      if (closed) {
        const face = makeFace(result);
        try {
          checkValid(
            face,
            label +
              " crosses or touches itself. Separate its overlapping edges.",
          );
        } finally {
          face.delete();
        }
      }
      return result;
    } catch (error) {
      result.delete();
      throw error;
    }
  } finally {
    curves.forEach((curve) => curve.delete());
  }
}

function makeLoft(
  op: Extract<EvaluatedProfileAdvanced, { kind: "loft" }>,
): Shape3D {
  if (
    !Number.isFinite(op.z1) ||
    !Number.isFinite(op.z2) ||
    Math.abs(op.z1 - op.z2) <= tolerance
  )
    throw Error("Enter two different finite Z heights for the loft sections.");
  const bottom = wire(op.lower, flat(op.z1), true, "The first loft section");
  try {
    const top = wire(op.upper, flat(op.z2), true, "The second loft section");
    try {
      return loft([bottom, top], { ruled: true });
    } finally {
      top.delete();
    }
  } finally {
    bottom.delete();
  }
}

function makeSweep(
  op: Extract<EvaluatedProfileAdvanced, { kind: "sweep" }>,
): Shape3D {
  const anchor = op.anchor ?? { x: 0, y: 0 };
  if (!finite(anchor) || !Number.isFinite(op.z))
    throw Error("Give the sweep a finite anchor and path height.");
  const path = wire(op.path, flat(op.z), false, "The sweep path");
  try {
    const start = op.path[0].start,
      tangent = path.tangentAt(0);
    let tx: number, ty: number;
    try {
      const [x, y] = tangent.toTuple(),
        length = Math.hypot(x, y);
      if (length <= tolerance)
        throw Error("The sweep must start with a well-defined tangent.");
      tx = x / length;
      ty = y / length;
    } finally {
      tangent.delete();
    }
    // Left of the first path tangent and world Z form a right-handed normal section.
    const section = wire(
      op.section,
      (p) => [
        start.x - ty * (p.x - anchor.x),
        start.y + tx * (p.x - anchor.x),
        op.z + p.y - anchor.y,
      ],
      true,
      "The sweep section",
    );
    try {
      return genericSweep(section, path, { transitionMode: "right" });
    } finally {
      section.delete();
    }
  } finally {
    path.delete();
  }
}

function volume(shape: Shape3D) {
  const props = measureShapeVolumeProperties(shape);
  try {
    return props.volume;
  } finally {
    props.delete();
  }
}

function solidVolume(shape: Shape3D) {
  checkValid(
    shape,
    "The edges intersect or the result folds onto itself. Adjust the profiles or path.",
  );
  const solids = shape.solids;
  try {
    if (solids.length !== 1)
      throw Error(
        "The result must be one connected solid. Move the profiles or change the operation.",
      );
  } finally {
    solids.forEach((s) => s.delete());
  }
  const result = volume(shape);
  if (!Number.isFinite(result) || result <= 0)
    throw Error(
      "The result has no positive solid volume. Check section size, orientation, and placement.",
    );
  return result;
}

/** The caller keeps ownership of body and owns the returned solid. */
export function applyProfileAdvanced(
  body: Shape3D,
  op: EvaluatedProfileAdvanced,
): Shape3D {
  let tool: Shape3D | undefined, result: Shape3D | undefined;
  try {
    tool = op.kind === "loft" ? makeLoft(op) : makeSweep(op);
    solidVolume(tool);
    if (op.mode === "replace") {
      const replacement = tool;
      tool = undefined;
      return replacement;
    }
    if (op.mode !== "add" && op.mode !== "cut")
      throw Error("Choose Add, Cut, or Replace.");
    const before = volume(body);
    result = op.mode === "add" ? body.fuse(tool) : body.cut(tool);
    const after = solidVolume(result),
      change = op.mode === "cut" ? before - after : after - before;
    if (change <= Math.max(1e-12, before * 1e-12))
      throw Error(
        op.mode === "cut"
          ? "The swept or lofted cutter misses the body. Move its path or sections into the material."
          : "The swept or lofted solid adds no new material to the body.",
      );
    const completed = result;
    result = undefined;
    return completed;
  } catch (error) {
    if (
      error instanceof Error &&
      !/wasm|BRep|Standard_|StdFail|unwrap|BindingError/i.test(error.message)
    )
      throw error;
    throw Error(
      op.kind === "sweep"
        ? "The sweep could not follow this path. Reduce the section size or soften tight corners."
        : "The loft could not connect these sections. Check their outlines and separate their heights.",
    );
  } finally {
    tool?.delete();
    result?.delete();
  }
}
