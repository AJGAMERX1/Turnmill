import { boxSketch, feature, project } from "../../systems/runtime.mjs";

export const barrelId = "qa-barrel", refillId = "qa-lr7";
export async function cappedPen(api, length = 127) {
  const { createThreadedCone, createThreadedCap } = await api.load("threadedCone");
  const { insertRefill } = await api.load("refills");
  const sleeve = project([boxSketch("section", 0, 5, length, 10)], [
    { ...feature(barrelId, "section", "360 deg", "revolve"), name: "Turned barrel" },
  ], { id: "capped-writing-fit-" + length, name: length === 127 ? "Capped EnerGel writing pen" : "Short capped pen " + length });
  const rim = (end, station) => ({ end, axis: "X", centerline: [0, 0, 0], outside: 20, bore: 10, station });
  const front = rim("end", length), rear = rim("start", 0);
  const pair = createThreadedCone(sleeve, barrelId, front, {
    end: "end", size: "M16 × 1", length: "3 mm", coneLength: "15 mm", tipDiameter: "4 mm",
    opening: "2.27 mm", allowance: "0.1 mm", mode: "cosmetic",
  });
  // Allow the M18 cap's minor diameter to pass over the cone.
  pair.project.parameters.find(p => p.name === "cone_base").expression = "16.7 mm";
  const cap = createThreadedCap(pair.project, barrelId, front, {
    end: "end", size: "M18 × 1", length: "2 mm", capLength: "30 mm", capDiameter: "20 mm",
    crown: "flat", crownLength: "0 mm", wall: "2 mm", allowance: "0.1 mm", mode: "cosmetic",
  }, rear);
  return { document: insertRefill(cap.project, "energel-lr7", {}, { bodyId: refillId }).project,
    capId: cap.capId, coneId: pair.coneId };
}
