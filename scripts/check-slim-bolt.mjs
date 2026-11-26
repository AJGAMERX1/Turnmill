import assert from "node:assert/strict";
import { runtime, near } from "../tests/systems/runtime.mjs";
const api = await runtime();
try {
  const { boltPenProject } = await api.load("boltPen"), { previewSlimBolt } = await api.load("slimBoltPen");
  const { slimDefaults } = await api.load("slimSizing");
  const p = boltPenProject();
  const result = await previewSlimBolt(p, slimDefaults);

  near(result.requested, 7, 1e-6, "widest Ø6 Parker plus one diametral millimetre");
  near(result.diameter, 10.84, 1e-5, "captured original retention ring leaves the requested wall");
  assert(result.slotGap > 0, "positive minimum clearance throughout bolt travel");
  assert(result.envelope > result.previous && result.envelope > result.diameter, "full rotary envelope includes the stud");
  near(result.exposure, 2.3, 1e-6, "writing position");
  near(result.recess, .8, 1e-6, "closed tip");
  near(result.springPressed, 8.4, 1e-6, "spring compressed space");
  near(result.carrierBore, 9.3, 1e-6, "spring chamber OD preserved");
  const second = await previewSlimBolt(result.project, { ...slimDefaults, method: "wall", wall: ".35 mm" });
  near(second.diameter, result.diameter, 1e-5, "radius mode produces the same physically limited barrel");
  const { insertRefill } = await api.load("refills");
  const gel = insertRefill(p, "energel-lr7", {}, { replaceBodyId: "bolt-refill" }).project;
  const gelResult = await previewSlimBolt(gel, slimDefaults);
  near(gelResult.widest, 6.35, 1e-5, "original EnerGel envelope");
  near(gelResult.springPressed, 8.4, 1e-5, "refill swap maintains spring compression space");
  await assert.rejects(previewSlimBolt(p, { ...slimDefaults, method: "wall", wall: "1.5 mm" }), /reduce the minimum wall/i);
  const custom = { ...p, features: p.features.map(f => f.id === "bolt-track-cut" ? { ...f, suppressed: true } : f) };
  await assert.rejects(previewSlimBolt(custom, slimDefaults), /custom geometry/);
  console.log("PASS physical bolt slimming, standard seal, full J-slot sweep, cartridge positions, spring space and clip/stud envelope.");
} finally { await api.close(); }
