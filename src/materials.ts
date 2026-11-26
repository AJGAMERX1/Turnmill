export const materials: Record<string, { density: number; color: number }> = {
  Brass: { density: 8.5, color: 0xd6a761 },
  Aluminum: { density: 2.7, color: 0xc0c9cc },
  Steel: { density: 7.85, color: 0x9da6a9 },
  Nitrile: { density: 1.2, color: 0x383b3a },
  Titanium: { density: 4.51, color: 0x999e9e },
  Acetal: { density: 1.41, color: 0x50585a },
};
export type BodyProps = { volume: number; center: [number, number, number] };
export function massProperties(
  bodies: BodyProps[],
  densities: number[],
): {
  mass: number;
  center: [number, number, number] | null;
} {
  let mass = 0;
  const moment: [number, number, number] = [0, 0, 0];
  bodies.forEach((body, i) => {
    const grams = (body.volume * densities[i]) / 1000;
    mass += grams;
    for (let axis = 0; axis < 3; axis++)
      moment[axis] += grams * body.center[axis];
  });
  if (!mass) return { mass: 0, center: null };
  return {
    mass,
    center: [moment[0] / mass, moment[1] / mass, moment[2] / mass],
  };
}
import { evaluate } from "./expressions";
export function parseDensity(
  text: string,
  values: Record<string, number>,
): number {
  const s = text.trim().replace(/³|\^3/g, "3");
  const m = s.match(/^(.*?)\s*(g\s*\/\s*cm3|kg\s*\/\s*m3|g\s*\/\s*mm3)$/i);
  const units = m?.[2].replace(/\s+/g, "").toLowerCase(),
    f = units === "kg/m3" ? 0.001 : units === "g/mm3" ? 1000 : 1;
  const d = evaluate(m ? m[1] : s, values, "scalar") * f;
  if (d <= 0) throw Error("Use a positive density in g/cm³ or kg/m³.");
  return d;
}
