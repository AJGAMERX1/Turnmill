import { materials } from "./materials";
import type { Project } from "./types";

export const metalFinishNames = {
  polished: "Polished",
  brushed: "Brushed",
  turned: "Lathe-turned",
  "bead-blasted": "Bead-blasted",
} as const;
export type MetalFinish = keyof typeof metalFinishNames;
export type BodySurface = { finish?: MetalFinish; anodize?: string };

export const anodizedColors: Record<string, string> = {
  Black: "#292e32", Blue: "#1964ad", Navy: "#243c63", Teal: "#167e7d",
  Green: "#327445", Violet: "#75499c", Red: "#ac343a", Bronze: "#94653c",
};
const metals = new Set(["Aluminum", "Brass", "Titanium", "Steel"]);
export const isMetal = (name: string) => metals.has(name);

export function bodyMaterialName(project: Project, bodyId: string) {
  const perBody = project.workspaces?.bodyMaterials?.[bodyId];
  const global = project.workspaces?.material;
  return typeof perBody === "string" && Object.hasOwn(materials, perBody) ? perBody
    : typeof global === "string" && Object.hasOwn(materials, global) ? global : "Brass";
}
function normalizedSurface(value: unknown): BodySurface {
  if (!value || typeof value !== "object") return {};
  const { finish, anodize } = value as BodySurface;
  const surface: BodySurface = {};
  if (typeof finish === "string" && Object.hasOwn(metalFinishNames, finish)) surface.finish = finish;
  if (typeof anodize === "string" && /^#[0-9a-f]{6}$/i.test(anodize)) surface.anodize = anodize.toLowerCase();
  return surface;
}
export function readSurface(project: Project, bodyId: string): BodySurface {
  return normalizedSurface(project.workspaces?.bodySurfaces?.[bodyId]);
}
export function setBodySurface(project: Project, bodyId: string, value: BodySurface): Project {
  if (!bodyId) return project;
  const prior = readSurface(project, bodyId), surface = normalizedSurface(value);
  if (prior.finish === surface.finish && prior.anodize === surface.anodize) return project;
  const bodySurfaces = { ...project.workspaces?.bodySurfaces };
  if (surface.finish || surface.anodize) bodySurfaces[bodyId] = surface;
  else delete bodySurfaces[bodyId];
  return { ...project, workspaces: { ...project.workspaces, bodySurfaces } };
}
export type DisplayAppearance = {
  color: number; finish: MetalFinish; metalness: number; roughness: number;
};

const roughnessByFinish: Record<MetalFinish, number> = {
  polished: .31, brushed: .41, turned: .34, "bead-blasted": .62,
};

// Older callers supply a base material color alone. Keep their metal and polymer
// reflectance identical to a project rendered with no appearance overrides.
export function naturalAppearance(color: number): DisplayAppearance {
  const polymer = color === materials.Acetal.color || color === materials.Nitrile.color;
  return { color, finish: "polished", metalness: polymer ? .05 : .79, roughness: polymer ? .5 : roughnessByFinish.polished };
}

export function appearanceForBody(project: Project, bodyId: string): DisplayAppearance {
  const material = bodyMaterialName(project, bodyId), natural = materials[material].color;
  if (!isMetal(material)) return naturalAppearance(natural);
  const surface = readSurface(project, bodyId), finish = surface.finish ?? "polished";
  const dye = material === "Aluminum" ? surface.anodize : undefined;
  // A dyed oxide reflects some light diffusely even over metallic aluminum.
  return { color: dye ? parseInt(dye.slice(1), 16) : natural, finish, metalness: dye ? .56 : .79,
    roughness: roughnessByFinish[finish] + (dye ? .06 : 0) };
}
