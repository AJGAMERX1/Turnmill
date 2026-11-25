import {
  cast,
  getOC,
  isShape3D,
  makeCompound,
  measureVolume,
  type AnyShape,
  type Shape3D,
} from "replicad";

type Axis = "X" | "Y" | "Z";
type Opening = "xMin" | "xMax" | "yMin" | "yMax" | "zMin" | "zMax";
type Plane = "XY" | "YZ" | "XZ";
export type EvaluatedTransform =
  | { kind: "shell"; face: Opening; thickness: number }
  | { kind: "mirror"; plane: Plane; offset: number; keepOriginal: boolean }
  | { kind: "linearPattern"; axis: Axis; count: number; spacing: number }
  | { kind: "circularPattern"; axis: Axis; count: number; stepAngle: number };

type Vector3 = [number, number, number];
type Bounds = [Vector3, Vector3];
const axes: Record<Axis, Vector3> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};
const planeAxes: Record<Plane, Axis> = { XY: "Z", YZ: "X", XZ: "Y" };
const epsilon = 1e-7;

function axisVector(axis: Axis, amount: number): Vector3 {
  const v = axes[axis];
  if (!v) throw new Error("Select the X, Y, or Z axis.");
  return [v[0] * amount, v[1] * amount, v[2] * amount];
}

function bounds(shape: AnyShape): Bounds {
  const oc = getOC(),
    box = new oc.Bnd_Box();
  try {
    oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false);
    return [
      [box.GetXMin(), box.GetYMin(), box.GetZMin()],
      [box.GetXMax(), box.GetYMax(), box.GetZMax()],
    ];
  } finally {
    box.delete();
  }
}

function valid(shape: Shape3D, message: string) {
  const checker = new (getOC().BRepCheck_Analyzer)(shape.wrapped, true);
  try {
    if (!checker.IsValid() || !(measureVolume(shape) > 0))
      throw new Error(message);
  } finally {
    checker.delete();
  }
}

function openShell(body: Shape3D, face: Opening, thickness: number): Shape3D {
  if (!Number.isFinite(thickness) || thickness <= epsilon)
    throw new Error("Enter a positive shell wall thickness.");
  if (!/^[xyz](Min|Max)$/.test(face))
    throw new Error("Select an opening from the six axial end faces.");
  const components = body.solids;
  try {
    if (components.length !== 1)
      throw new Error(
        "Shell requires one connected solid. Place the shell before a pattern of separate solids.",
      );
  } finally {
    components.forEach((s) => s.delete());
  }
  const i = "xyz".indexOf(face[0]),
    side = face.endsWith("Min") ? 0 : 1;
  const location = bounds(body)[side][i],
    faces = body.faces;
  try {
    const candidates = faces.filter((f) => {
      if (f.geomType !== "PLANE") return false;
      const [min, max] = bounds(f);
      return (
        Math.abs(min[i] - location) < epsilon * 5 &&
        Math.abs(max[i] - location) < epsilon * 5
      );
    });
    if (!candidates.length)
      throw new Error(
        "The selected extreme has no planar end face. Choose another opening.",
      );
    if (candidates.length !== 1)
      throw new Error(
        "Several planar faces share this end. Choose an opening with one planar face.",
      );
    const oc = getOC();
    const openings = new oc.NCollection_List_TopoDS_Shape(),
      builder = new oc.BRepOffsetAPI_MakeThickSolid();
    try {
      openings.Append(candidates[0].wrapped);
      builder.MakeThickSolidByJoin(
        body.wrapped,
        openings,
        -thickness,
        1e-5,
        oc.BRepOffset_Mode.BRepOffset_Skin,
        false,
        false,
        oc.GeomAbs_JoinType.GeomAbs_Arc,
        false,
      );
      if (!builder.IsDone())
        throw new Error(
          "This wall thickness collapses the shell. Reduce the thickness or choose a different opening.",
        );
      const raw = builder.Shape();
      try {
        const result = cast(raw);
        try {
          if (!isShape3D(result))
            throw new Error("The shell did not form a closed wall.");
          valid(
            result,
            "The shell wall crosses itself. Reduce its thickness or choose a different opening.",
          );
          if (measureVolume(result) >= measureVolume(body))
            throw new Error(
              "The shell did not remove material. Reduce the wall thickness.",
            );
          return result;
        } catch (error) {
          result.delete();
          throw error;
        }
      } finally {
        raw.delete();
      }
    } finally {
      builder.delete();
      openings.delete();
    }
  } finally {
    faces.forEach((f) => f.delete());
  }
}

function boxesTouch([a, b]: Bounds, [c, d]: Bounds) {
  return a.every((min, i) => min <= d[i] + epsilon && c[i] <= b[i] + epsilon);
}
type Group = { shape: Shape3D; bounds: Bounds };

/** Avoid costly booleans between separated copies. Fuse every group touched by a new instance. */
function pattern(
  body: Shape3D,
  count: number,
  copy: (i: number) => Shape3D,
): Shape3D {
  if (!Number.isInteger(count) || count < 2 || count > 512)
    throw new Error(
      "Enter a total of 2 to 512 instances, including the original.",
    );
  const groups: Group[] = [];
  try {
    groups.push({ bounds: bounds(body), shape: body.clone() });
    for (let i = 1; i < count; i++) {
      let candidate: Shape3D | undefined = copy(i);
      try {
        const box = bounds(candidate);
        const nearby = groups.filter((group) => boxesTouch(box, group.bounds));
        let previousVolume = 0;
        for (const group of nearby) {
          previousVolume += measureVolume(group.shape);
          const joined = group.shape.fuse(candidate);
          candidate.delete();
          candidate = joined;
        }
        if (nearby.length) {
          if (
            measureVolume(candidate) <=
            previousVolume + Math.max(1e-12, previousVolume * 1e-12)
          )
            throw new Error(
              "An instance coincides with existing material. Adjust the spacing, angle, count, or mirror offset.",
            );
          for (const group of nearby) {
            groups.splice(groups.indexOf(group), 1);
            group.shape.delete();
          }
        }
        groups.push({
          shape: candidate,
          bounds: nearby.length ? bounds(candidate) : box,
        });
        candidate = undefined;
      } finally {
        candidate?.delete();
      }
    }
    if (groups.length === 1) {
      const single = groups[0].shape;
      valid(
        single,
        "These instances cannot form valid solids. Adjust their spacing or angle.",
      );
      groups.length = 0;
      return single;
    }
    const compound = makeCompound(groups.map((g) => g.shape));
    groups.length = 0; // makeCompound takes ownership of its inputs.
    try {
      if (!isShape3D(compound))
        throw new Error("The repeated shapes could not be combined.");
      valid(
        compound,
        "These instances have invalid contact. Adjust the spacing or angle.",
      );
      return compound;
    } catch (error) {
      compound.delete();
      throw error;
    }
  } finally {
    groups.forEach((group) => group.shape.delete());
  }
}

/** Requires an initialized OpenCascade instance. Caller owns the new returned shape. */
export function applyTransform(body: Shape3D, op: EvaluatedTransform): Shape3D {
  try {
    switch (op.kind) {
      case "shell":
        return openShell(body, op.face, op.thickness);
      case "mirror": {
        if (!planeAxes[op.plane] || !Number.isFinite(op.offset))
          throw new Error(
            "Choose a mirror plane and enter a finite plane offset.",
          );
        const origin = axisVector(planeAxes[op.plane], op.offset);
        const mirrored = () => body.clone().mirror(op.plane, origin);
        return op.keepOriginal ? pattern(body, 2, mirrored) : mirrored();
      }
      case "linearPattern": {
        if (!Number.isFinite(op.spacing) || Math.abs(op.spacing) <= epsilon)
          throw new Error("Enter a nonzero instance spacing.");
        return pattern(body, op.count, (i) =>
          body.clone().translate(axisVector(op.axis, i * op.spacing)),
        );
      }
      case "circularPattern": {
        if (
          !Number.isFinite(op.stepAngle) ||
          Math.abs(op.stepAngle % 360) < 1e-8
        )
          throw new Error(
            "Enter an angular increment other than zero or a full turn.",
          );
        const axis = axisVector(op.axis, 1);
        return pattern(body, op.count, (i) =>
          body.clone().rotate(i * op.stepAngle, [0, 0, 0], axis),
        );
      }
      default:
        throw new Error("Unknown body operation.");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message &&
      !/BindingError|wasm|TopoDS|Aborted|std::/i.test(error.message)
    )
      throw error;
    throw new Error(
      op.kind === "shell"
        ? "The kernel could not offset this body. Reduce wall thickness or choose another planar opening."
        : "The transformed bodies have invalid contact. Change the plane, spacing, or angle.",
    );
  }
}
