import { evaluate } from "./expressions";

export type SlimSettings = { method: "diameter" | "wall"; allowance: string; wall: string; wallFloor: string; runningClearance: string };
export const slimDefaults: SlimSettings = { method: "diameter", allowance: "1 mm", wall: "1 mm", wallFloor: "0.35 mm", runningClearance: "0.20 mm" };

export function savedSlimSettings(raw?: Partial<SlimSettings>): SlimSettings {
  return {
    method: raw?.method === "wall" ? "wall" : "diameter",
    allowance: raw?.allowance ?? slimDefaults.allowance,
    wall: raw?.wall ?? slimDefaults.wall,
    wallFloor: raw?.wallFloor ?? slimDefaults.wallFloor,
    runningClearance: raw?.runningClearance ?? slimDefaults.runningClearance,
  };
}

export function readSlimAllowances(settings: SlimSettings, values: Record<string,number>) {
  function positive(text: string, field: string) {
    const n = evaluate(text, values);
    if (!Number.isFinite(n) || n <= 0) throw Error("Enter a positive " + field + ".");
    return n;
  }
  const wall = positive(settings.method === "wall" ? settings.wall : settings.wallFloor, "minimum wall thickness");
  const clearance = positive(settings.runningClearance, "diametral running clearance");
  const allowance = settings.method === "diameter" ? positive(settings.allowance, "diameter allowance") : 0;
  return { wall, clearance, allowance };
}
