import { getOC, type Face, type Shape3D } from "replicad";
import { endRadii } from "./threadPreparation";
import { solidBounds } from "./secondaryProjection";
import type { WritingBodyGeometry, WritingSeatFace } from "./writingFit";

/** A complete disk or annulus proves there is a bearing face at this station.
 * Partial shoulders, slots and offset holes need an individual fit inspection. */
function measureSeatFace(face: Face): WritingSeatFace | undefined {
  const normal = face.normalAt();
  let direction: number[];
  try { direction = normal.toTuple(); } finally { normal.delete(); }
  const index = direction.findIndex(n => Math.abs(n) >= 1 - 1e-8);
  if (index !== 0 && index !== 2) return;
  const edges = face.edges;
  let center: [number, number, number];
  try {
    if (edges[0]?.geomType !== "CIRCLE") return;
    const curve = new (getOC().BRepAdaptor_Curve)(edges[0].wrapped);
    try {
      const circle = curve.Circle();
      try {
        const p = circle.Location();
        try { center = [p.X(), p.Y(), p.Z()]; } finally { p.delete(); }
      } finally { circle.delete(); }
    } finally { curve.delete(); }
  } finally { edges.forEach(edge => edge.delete()); }
  const rim = endRadii(face, { axis: index, center, endCoord: center[index] });
  if (!rim) return;
  return { axis: index === 0 ? "X" : "Z", direction: Math.sign(direction[index]), center,
    inner: 2 * rim.bore, outer: 2 * rim.outer };
}

export function measureWritingBodyGeometry(shape: Shape3D): WritingBodyGeometry {
  const faces = shape.faces;
  try {
    const seats: WritingSeatFace[] = [];
    for (const face of faces) {
      if (face.geomType !== "PLANE") continue;
      const measured = measureSeatFace(face);
      if (measured) seats.push(measured);
    }
    return { bounds: solidBounds(shape), seats };
  } finally { faces.forEach(f => f.delete()); }
}
