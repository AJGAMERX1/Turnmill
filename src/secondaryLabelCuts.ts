import {
  addHolesInFace,
  assembleWire,
  basicFaceExtrusion,
  makeBezierCurve,
  makeFace,
  makeLine,
  Vector,
  type Edge,
  type Shape3D,
} from "replicad";
import type { Artwork, InkOutline } from "./markArtwork";
function labelWire(loop: InkOutline, z: number) {
  const edges: Edge[] = [];
  try {
    for (const seg of loop) {
      const points = seg.map(([x, y]) => [x, y, z] as [number, number, number]);
      edges.push(
        points.length === 2
          ? makeLine(points[0], points[1])
          : makeBezierCurve(points),
      );
    }
    return assembleWire(edges);
  } finally {
    edges.forEach((e) => e.delete());
  }
}
export function buildScaleLabelCutters(
  labels: Artwork["outlines"],
  z: number,
  height: number,
): Shape3D[] {
  const solids: Shape3D[] = [],
    direction = new Vector([0, 0, height]);
  try {
    for (const glyph of labels) {
      const outer = labelWire(glyph.outer, z);
      let face;
      try {
        face = makeFace(outer);
      } finally {
        outer.delete();
      }
      try {
        const holes: ReturnType<typeof labelWire>[] = [];
        try {
          for (const hole of glyph.holes) holes.push(labelWire(hole, z));
          if (holes.length) {
            const next = addHolesInFace(face, holes);
            face.delete();
            face = next;
          }
        } finally {
          holes.forEach((h) => h.delete());
        }
        solids.push(basicFaceExtrusion(face, direction));
      } finally {
        face.delete();
      }
    }
    return solids;
  } catch (e) {
    solids.forEach((s) => s.delete());
    throw e;
  } finally {
    direction.delete();
  }
}
