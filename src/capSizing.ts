import { evaluate } from "./expressions";
import type { CapSettings } from "./threadedCone";

export type CapDepthFit = { part: string; requiredDepth: number };
const mm = (n: number) => Number(n.toFixed(6)) + " mm";

// Preserve a named dimension or arithmetic input as the driver after a fit adjustment.
function offsetInput(input: string, before: number, after: number) {
  const increasing = after > before;
  if (/^\s*\d*\.?\d+\s*(?:mm)?\s*$/.test(input)) {
    const rounded = (increasing ? Math.ceil : Math.floor)(after * 1e6) / 1e6;
    return mm(rounded);
  }
  const difference = Math.ceil(Math.abs(after - before) * 1e6) / 1e6;
  return "(" + input + ")" + (increasing ? " + " : " - ") + mm(difference);
}

export function fitCapEnvelope(input: CapSettings, values: Record<string, number>, major: number, fit?: CapDepthFit) {
  const read = (s: string) => evaluate(s, values);
  const settings = { ...input }, changes: string[] = [];
  const enteredDiameter = read(input.capDiameter), enteredLength = read(input.capLength);
  let diameter = enteredDiameter;
  const wall = read(input.wall), thread = read(input.length);
  let crown = input.crown === "flat" ? 0 : read(input.crownLength);
  if (!(diameter > 0 && enteredLength > 0 && wall > 0 && thread > 0 && (input.crown === "flat" || crown > 0)))
    throw Error("Enter positive cap dimensions to calculate the fit.");

  if (diameter <= major + 1e-5) {
    diameter = major + 2;
    settings.capDiameter = offsetInput(input.capDiameter, enteredDiameter, diameter);
    changes.push("Cap diameter increased to " + mm(diameter) + " for a 1 mm socket wall.");
  }
  if (input.crown === "domed" && crown > diameter / 2) {
    settings.crownLength = offsetInput(input.crownLength, crown, diameter / 2);
    crown = read(settings.crownLength);
    changes.push("Dome height reduced to " + mm(crown) + " to fit the cap diameter.");
  }
  const depth = Math.max(thread, fit?.requiredDepth ?? 0);
  if (enteredLength - wall - crown < depth) {
    // Allow a quarter millimetre between the last engaged thread or tip and the interior roof.
    const length = Math.ceil((depth + wall + crown + 0.25) * 10000) / 10000;
    settings.capLength = offsetInput(input.capLength, enteredLength, length);
    changes.push("Cap length increased to " + mm(length) + (fit ? " to clear " + fit.part + "." : " for the threads and end wall."));
  }
  return { settings, changes, cavityDepth: read(settings.capLength) - wall - crown };
}
