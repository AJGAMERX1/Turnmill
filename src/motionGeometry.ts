import { cast, getOC, type AnyShape, type Shape3D } from "replicad";
const tolerances = new WeakMap<AnyShape, number>();
export function shapeTolerance(shape: AnyShape) {
  const cached = tolerances.get(shape);
  if (cached !== undefined) return cached;
  const oc = getOC(),
    types = oc.TopAbs_ShapeEnum;
  const margin = Math.max(
    ...[types.TopAbs_VERTEX, types.TopAbs_EDGE, types.TopAbs_FACE].map((k) =>
      oc.BRep_Tool.MaxTolerance(shape.wrapped, k),
    ),
  );
  tolerances.set(shape, margin);
  return margin;
}
export function positioned(shape: Shape3D, m: number[]) {
  const oc = getOC(),
    t = new oc.gp_Trsf();
  try {
    t.SetValues(
      m[0],
      m[4],
      m[8],
      m[12],
      m[1],
      m[5],
      m[9],
      m[13],
      m[2],
      m[6],
      m[10],
      m[14],
    );
    const loc = new oc.TopLoc_Location(t);
    try {
      return cast(shape.wrapped.Moved(loc)).asShape3D();
    } finally {
      loc.delete();
    }
  } finally {
    t.delete();
  }
}
