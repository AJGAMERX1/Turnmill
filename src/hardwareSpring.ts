import {
  getOC,
  makeHelix,
  makeCircle,
  assembleWire,
  genericSweep,
} from "replicad";

/** Open, unground end geometry. Choose the centerline height so the wire's exterior span equals freeLength. */
export function makeReferenceSpring(
  od: number,
  wire: number,
  freeLength: number,
  turns: number,
) {
  if (
    !(
      od > 2 * wire &&
      freeLength > wire &&
      turns >= 1 &&
      Number.isInteger(turns)
    )
  )
    throw Error(
      "Choose a positive wire size, at least one full turn, and an outside diameter greater than twice the wire.",
    );
  const r = (od - wire) / 2;
  let h = freeLength - wire;
  for (let i = 0; i < 8; i++)
    h = freeLength - wire / Math.sqrt(1 + (h / turns / (2 * Math.PI * r)) ** 2);
  if (h / turns <= wire)
    throw Error(
      "Increase free length or reduce the number of turns so neighboring coils clear each other.",
    );
  const pitch = h / turns;
  const helix = makeHelix(pitch, h, r, [0, 0, (freeLength - h) / 2]),
    p = helix.startPoint,
    tangent = helix.tangentAt(0);
  const circle = makeCircle(wire / 2, p, tangent),
    section = assembleWire([circle]);
  circle.delete();
  p.delete();
  tangent.delete();
  try {
    const spring = genericSweep(section, helix, { frenet: true });
    const valid = new (getOC().BRepCheck_Analyzer)(spring.wrapped, true);
    try {
      if (!valid.IsValid()) {
        spring.delete();
        throw Error("These spring dimensions do not produce a closed solid.");
      }
    } finally {
      valid.delete();
    }
    return spring;
  } finally {
    section.delete();
    helix.delete();
  }
}
