import { getOC, makePolygon, measureVolume, revolution, type Face, type Shape3D } from "replicad";
import { threadMinorDiameter, type EvaluatedFinish } from "./finishingTypes";

type Thread = Extract<EvaluatedFinish, { kind: "thread" }>;
export type ThreadAxisFrame = { axis: number; center: [number, number, number]; endCoord: number; span: number; radialBound: number };
const tolerance = 1e-6;

// Require a complete centered disk or annulus so adding a tenon cannot cover an
// off-center ink passage, a slot or part of the original bore.
function endRadii(face: Face, frame: ThreadAxisFrame) {
  const edges = face.edges;
  const rings: { radius: number; length: number }[] = [];
  try {
    for (const edge of edges) {
      if (edge.geomType !== "CIRCLE") return;
      const curve = new (getOC().BRepAdaptor_Curve)(edge.wrapped);
      const circle = curve.Circle(), origin = circle.Location(), axis = circle.Axis(), normal = axis.Direction();
      try {
        const center = [origin.X(), origin.Y(), origin.Z()];
        if (Math.abs([normal.X(), normal.Y(), normal.Z()][frame.axis]) < 1 - 1e-9 ||
            center.some((v, i) => Math.abs(v - (i === frame.axis ? frame.endCoord : frame.center[i])) > tolerance)) return;
        const radius = circle.Radius();
        const ring = rings.find(v => Math.abs(v.radius - radius) < tolerance);
        if (ring) ring.length += edge.length;
        else rings.push({ radius, length: edge.length });
      } finally { normal.delete(); axis.delete(); origin.delete(); circle.delete(); curve.delete(); }
    }
  } finally { edges.forEach(edge => edge.delete()); }
  if (!rings.length || rings.length > 2 ||
      rings.some(r => Math.abs(r.length - 2 * Math.PI * r.radius) > Math.max(tolerance, r.radius * 1e-7))) return;
  rings.sort((a, b) => a.radius - b.radius);
  return { outer: rings[rings.length - 1].radius, bore: rings.length === 2 ? rings[0].radius : 0 };
}

function tenonFace(shape: Shape3D, frame: ThreadAxisFrame) {
  const faces = shape.faces;
  try {
    for (const face of faces) {
      if (face.geomType !== "PLANE") continue;
      const rings = endRadii(face, frame);
      if (rings) return rings;
    }
    throw Error("The tenon needs a flat, round end on the part axis. Choose the broad end of the cone, or edit the sketch to give it a flat shoulder.");
  } finally { faces.forEach(f => f.delete()); }
}

function boreOrRing(frame: ThreadAxisFrame, start: number, length: number, outer: number, inner = 0) {
  // Use the turning meridian's seam convention so coincident bores can unify.
  const point = (station: number, radius: number): [number, number, number] => {
    const p: [number, number, number] = [...frame.center];
    p[frame.axis] = station;
    p[frame.axis === 0 ? 1 : 0] += radius;
    return p;
  };
  const face = makePolygon([point(start, inner), point(start, outer),
    point(start + length, outer), point(start + length, inner)]);
  try { return revolution(face, frame.center, frame.axis === 0 ? [1, 0, 0] : [0, 0, 1], 360); }
  finally { face.delete(); }
}

/** The difference between an oversized axial slab and the stock separates the
 * outer air from internal voids. Fill the central bore while preserving the
 * exterior, other drilled holes, and any thicker existing blind bottom. */
function closeBack(shape: Shape3D, f: Thread, frame: ThreadAxisFrame, depth: number) {
  if (f.length + depth > frame.span + tolerance)
    throw Error("The socket would run into the back wall. Shorten the thread, reduce the back wall thickness, or lengthen the body.");
  const back = frame.endCoord + (f.end === "start" ? frame.span : -frame.span);
  const start = f.end === "start" ? back - depth : back;
  const radius = 2 * frame.radialBound + 1;
  const envelope = boreOrRing(frame, start, depth, radius);
  try {
    const air = envelope.cut(shape);
    try {
      const pockets = air.solids;
      const witness = boreOrRing(frame, start, depth, Math.min(radius * 0.01, 0.05));
      let filled = shape.clone();
      try {
        const transverse = frame.axis === 0 ? 1 : 0;
        for (const pocket of pockets) {
          const box = pocket.boundingBox;
          let exterior: boolean;
          try { exterior = box.bounds[1][transverse] >= frame.center[transverse] + radius - tolerance; }
          finally { box.delete(); }
          if (exterior) continue;
          const central = pocket.intersect(witness);
          try { if (measureVolume(central) < 1e-12) continue; }
          finally { central.delete(); }
          const next = filled.fuse(pocket);
          filled.delete();
          filled = next;
        }
        const missing = witness.cut(filled);
        try {
          if (measureVolume(missing) > 1e-9)
            throw Error("The back wall opens into the side of the part. Choose a shorter thickness or close the side opening first.");
        } finally { missing.delete(); }
        return filled;
      } catch (error) { filled.delete(); throw error; }
      finally { witness.delete(); pockets.forEach(pocket => pocket.delete()); }
    } finally { air.delete(); }
  } finally { envelope.delete(); }
}

/** Allow shallow, open grip flutes with a complete annular backing. A bore
 * reaching either end plane can communicate with the exterior through a side
 * opening inside the band. Its separate cut face must remain open. */
function isShallowRelief(exterior: Shape3D, shape: Shape3D, frame: ThreadAxisFrame, start: number,
  span: number, stock: number, pitch: number, slabRadius: number) {
  const floor = stock - Math.min(stock * 0.1, pitch / 2);
  const core = boreOrRing(frame, start, span, floor);
  try {
    const deep = exterior.intersect(core);
    try { if (measureVolume(deep) > 1e-8) return false; } finally { deep.delete(); }
  } finally { core.delete(); }
  const web = boreOrRing(frame, start, span, floor, floor - Math.min(floor / 20, 0.01));
  try {
    const missing = web.cut(shape);
    try { if (measureVolume(missing) > 1e-8) return false; } finally { missing.delete(); }
  } finally { web.delete(); }

  const faces = exterior.faces;
  const transverse = frame.axis === 0 ? 1 : 0;
  try {
    for (const face of faces) {
      if (face.geomType === "PLANE") {
        const box = face.boundingBox;
        try {
          const [lo, hi] = box.bounds;
          if (hi[frame.axis] - lo[frame.axis] < tolerance &&
            (Math.abs(lo[frame.axis] - start) < tolerance || Math.abs(lo[frame.axis] - start - span) < tolerance) &&
            hi[transverse] < frame.center[transverse] + slabRadius - tolerance) return false;
        } finally { box.delete(); }
      }
      if (face.geomType === "CYLINDRE") {
        const surface = face.surface, cylinder = surface.wrapped.Cylinder();
        const axis = cylinder.Axis(), direction = axis.Direction(), loc = axis.Location();
        try {
          const aligned = Math.abs([direction.X(), direction.Y(), direction.Z()][frame.axis]) > 1 - 1e-8;
          const concentric = aligned && [loc.X(), loc.Y(), loc.Z()].every((v, i) => i === frame.axis || Math.abs(v - frame.center[i]) < tolerance);
          const { uMin, uMax } = face.UVBounds;
          // A milled flute has semicircular end walls. A side port or an
          // eccentric drilled passage wraps around its cutter axis.
          if (!concentric && uMax - uMin > Math.PI + 1e-5) return false;
        } finally { loc.delete(); direction.delete(); axis.delete(); cylinder.delete(); surface.delete(); }
      }
    }
    return true;
  } finally { faces.forEach(face => face.delete()); }
}

/** Dress just the collar band, following the actual exterior under it. Air inside
 * a socket (including its helix) is a separate solid from the exterior air in
 * this axial slice. Subtract those internal voids from the collar blank before
 * fusing it; using the end bore alone would fill deeper shoulders and threads. */
function dressCollar(shape: Shape3D, blank: Shape3D, frame: ThreadAxisFrame, start: number, span: number, minor: number, stock: number, pitch: number) {
  const radius = frame.radialBound * 2 + 1;
  const slab = boreOrRing(frame, start, span, radius);
  try {
    // Preserve details beyond the requested collar diameter. A larger collar
    // or a shorter engagement is needed when the blank cannot enclose them.
    const original = shape.intersect(slab);
    try {
      const excess = original.cut(blank);
      try {
        if (measureVolume(excess) > 1e-7) throw Error("This collar would trim a larger shoulder. Choose a larger cap thread or a shorter engagement.");
      } finally { excess.delete(); }
    } finally { original.delete(); }

    const air = slab.cut(shape);
    try {
      const pockets = air.solids;
      let dressed = blank.clone();
      try {
        const transverse = frame.axis === 0 ? 1 : 0;
        let foundExterior = false;
        for (const pocket of pockets) {
          const box = pocket.boundingBox;
          let exterior: boolean;
          try { exterior = box.bounds[1][transverse] >= frame.center[transverse] + radius - tolerance; }
          finally { box.delete(); }
          if (exterior) {
            foundExterior = true;
            // A turned relief has the same exterior at every angle. A side port
            // or bolt slot changes the exterior at some angles, even when its
            // channel is off-axis and never reaches the central bore. Use an
            // irrational fraction of a revolution to avoid matching a pattern.
            const rotated = pocket.clone().rotate(180 * Math.SQRT2, frame.center, frame.axis === 0 ? [1, 0, 0] : [0, 0, 1]);
            try {
              const mismatch = pocket.cut(rotated);
              try {
                if (measureVolume(mismatch) > 1e-7 && !isShallowRelief(pocket, shape, frame, start, span, stock, pitch, radius))
                  throw Error("The collar crosses a side opening or a non-round feature. Shorten the engagement to keep it clear.");
              } finally { mismatch.delete(); }
            } finally { rotated.delete(); }
            const axis = boreOrRing(frame, start, span, Math.min(minor / 10, 0.05));
            try {
              const opening = pocket.intersect(axis);
              try {
                if (measureVolume(opening) > 1e-9)
                  throw Error("The collar would close an opening into the barrel bore. Shorten the thread to keep the opening clear.");
              } finally { opening.delete(); }
            } finally { axis.delete(); }
          } else {
            const next = dressed.cut(pocket);
            dressed.delete();
            dressed = next;
          }
        }
        if (!foundExterior) throw Error("The collar's outside surface could not be measured. Choose a different mounting face.");
        const root = boreOrRing(frame, start, span, minor, minor - Math.min(minor / 20, 0.01));
        try {
          const missing = root.cut(dressed);
          try {
            if (measureVolume(missing) > 1e-8)
              throw Error("The thread root would break into a passage inside the barrel. Choose a larger cap thread.");
          } finally { missing.delete(); }
        } finally { root.delete(); }
        return shape.fuse(dressed);
      } finally { dressed.delete(); pockets.forEach(pocket => pocket.delete()); }
    } finally { air.delete(); }
  } finally { slab.delete(); }
}

/** Model the straight substrate, regardless of whether the helix is cosmetic. */
export function prepareThreadStock(shape: Shape3D, f: Thread, frame: ThreadAxisFrame, onAutoFit?: (message: string) => void): Shape3D {
  const radius = f.diameter / 2;
  const minor = threadMinorDiameter(f.diameter, f.pitch) / 2;
  if (f.preparation === "flush") {
    // Both the turned seat and the helix are cuts. The end plane remains the
    // original datum for the screw mate, including on imported offset stock.
    const stopWidth = Math.min(f.pitch / 20, 0.05);
    if (f.length + stopWidth > frame.span)
      throw Error("Shorten the cap thread to leave a shoulder on the barrel.");
    const start = frame.endCoord - (f.end === "end" ? f.length : 0);
    const rootWall = Math.min(minor / 10, 0.01);
    const section = boreOrRing(frame, start, f.length, radius, minor - rootWall);
    try {
      const missing = section.cut(shape);
      try {
        if (measureVolume(missing) > Math.max(1e-8, measureVolume(section) * 1e-8))
          throw Error("This thread crosses a groove, bore, or socket in the barrel wall. Choose a size and length that fit the original stock.");
      } finally { missing.delete(); }
    } finally { section.delete(); }

    const shoulderStart = f.end === "end" ? start - stopWidth : start + f.length;
    const shoulder = boreOrRing(frame, shoulderStart, stopWidth, radius + rootWall, radius);
    try {
      const missing = shoulder.cut(shape);
      try {
        if (measureVolume(missing) > 1e-8)
          throw Error("The barrel needs a shoulder behind this thread for the cap to seat. Choose a smaller thread or adjust its length.");
      } finally { missing.delete(); }
    } finally { shoulder.delete(); }

    const trim = boreOrRing(frame, start, f.length, 2 * frame.radialBound + 1, radius);
    try { return shape.cut(trim); } finally { trim.delete(); }
  }
  if (f.preparation === "collar") {
    // External stock behind the original end keeps the socket and its fitted
    // cone in place. The unthreaded flange provides a positive stop for the cap.
    const stock = (f.collarStockDiameter ?? 0) / 2;
    if (!(stock > 0) || minor <= stock + tolerance)
      throw Error("Choose a larger cap thread so its root clears the original barrel diameter.");
    const span = f.length + f.pitch;
    if (span > frame.span + tolerance)
      throw Error("Shorten the cap thread to leave room for its stop collar on the barrel.");
    const start = frame.endCoord - (f.end === "end" ? span : 0);
    const overlapRadius = stock - Math.min(stock / 20, 0.01);
    const support = boreOrRing(frame, start, span, stock, overlapRadius);
    let adapt: boolean;
    try {
      const missing = support.cut(shape);
      try { adapt = measureVolume(missing) > Math.max(1e-8, measureVolume(support) * 1e-7); }
      finally { missing.delete(); }
    } finally { support.delete(); }
    if (!adapt) {
      const outside = boreOrRing(frame, start, span, stock + 0.01, stock);
      try {
        const blocked = outside.intersect(shape);
        try { adapt = measureVolume(blocked) > Math.max(1e-8, measureVolume(outside) * 1e-7); }
        finally { blocked.delete(); }
      } finally { outside.delete(); }
    }
    const inner = adapt ? 0 : overlapRadius;
    const band = boreOrRing(frame, start, span, radius, inner);
    const flangeStart = f.end === "end" ? start : start + f.length;
    try {
      const flange = boreOrRing(frame, flangeStart, f.pitch, radius + f.pitch / 2, inner);
      try {
        const tool = band.fuse(flange);
        try {
          if (!adapt) return shape.fuse(tool);
          const result = dressCollar(shape, tool, frame, start, span, minor, stock, f.pitch);
          onAutoFit?.("Formed a continuous collar seat at the " + f.end + " of the barrel.");
          return result;
        } finally { tool.delete(); }
      } finally { flange.delete(); }
    } finally { band.delete(); }
  }
  if (f.preparation === "tenon") {
    const { outer, bore } = tenonFace(shape, frame);
    if (radius > outer + tolerance)
      throw Error("The thread is wider than this end face. Select the broad end, reduce the thread size, or increase the cone diameter.");
    if (minor <= bore + tolerance)
      throw Error("The groove would break through the bore in the tenon. Increase the thread diameter, use a finer pitch, or reduce the bore.");
    const tenon = boreOrRing(frame, frame.endCoord - (f.end === "start" ? f.length : 0), f.length, radius, bore);
    try { return shape.fuse(tenon); } finally { tenon.delete(); }
  }
  if (f.length > frame.span + tolerance)
    throw Error("The socket extends past the opposite end. Shorten the thread length.");
  const start = frame.endCoord - (f.end === "end" ? f.length : 0);
  // The entire depth needs both a full internal thread profile and material
  // outside the major diameter. Use exact solids to catch side holes and tapers.
  const wall = boreOrRing(frame, start, f.length, radius + tolerance * 10, minor);
  try {
    const missing = wall.cut(shape);
    try {
      if (measureVolume(missing) > Math.max(1e-9, measureVolume(wall) * 1e-9))
        throw Error("This end cannot contain the full socket. The existing bore must fit inside the pilot diameter and the wall must extend beyond the major diameter for the full thread length. Change the size, shorten the thread, or choose the other end.");
    } finally { missing.delete(); }
  } finally { wall.delete(); }
  const pilot = boreOrRing(frame, start, f.length, minor);
  try {
    const drilled = shape.cut(pilot);
    if (f.backWall === undefined) return drilled;
    try { return closeBack(drilled, f, frame, f.backWall); }
    finally { drilled.delete(); }
  } finally { pilot.delete(); }
}
