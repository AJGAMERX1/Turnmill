import type { Feature, PartTab, Project, Sketch } from "./types";

// The New body feature is the document identity used by assembly and export.
// Only parts awaiting their first solid need an additional project entry.
export function projectPartTabs(project: Project): PartTab[] {
  return [
    ...project.features.filter((f) => f.operation === "new").map(({ id, name }) => ({ id, name })),
    ...(project.emptyParts ?? []),
  ];
}

/** Older documents store a boolean operation's target implicitly as the last active body. */
export function bodyOwners(features: Feature[]): Map<string, string | undefined> {
  const owners = new Map<string, string | undefined>();
  let active: string | undefined;
  let preceding: string | undefined;
  for (const f of features) {
    if (f.operation === "new") {
      preceding = f.id;
      if (!f.suppressed) active = f.id;
      owners.set(f.id, f.id);
    } else {
      owners.set(f.id, f.bodyId ?? (f.suppressed ? preceding : active) ?? preceding);
    }
  }
  return owners;
}

/** Bind old positional targets before an edit can change the body preceding a cut. */
export function bindHistoryTargets(features: Feature[]): Feature[] {
  const owners = bodyOwners(features);
  return features.map((f) => {
    const target = owners.get(f.id);
    return f.operation !== "new" && !f.bodyId && target ? { ...f, bodyId: target } : f;
  });
}

export function partFeatures(project: Project, partId: string): Feature[] {
  const owners = bodyOwners(project.features);
  return project.features.filter((f) => owners.get(f.id) === partId);
}

/** Profiles referenced by a retained feature, including histories absorbed by earlier merges. */
function collectSketchIds(feature: Feature, ids: Set<string>) {
  if (feature.sketchId) ids.add(feature.sketchId);
  const operations = [
    ...(feature.advanced ? [feature.advanced] : []),
    ...(feature.operations ?? []).map(entry => entry.operation),
  ];
  for (const op of operations) {
    if (op.kind === "loft") { ids.add(op.lowerId); ids.add(op.upperId); }
    if (op.kind === "sweep") { ids.add(op.pathId); ids.add(op.sectionId); }
  }
  for (const nested of feature.merge?.features ?? []) collectSketchIds(nested, ids);
}

export function featureUsesSketch(feature: Feature, sketchId: string) {
  const ids = new Set<string>();
  collectSketchIds(feature, ids);
  return ids.has(sketchId);
}

export function partSketches(project: Project, partId: string, features: Feature[]): Sketch[] {
  const used = new Set<string>();
  for (const feature of features) collectSketchIds(feature, used);
  return project.sketches.filter((s) => s.partId === partId || used.has(s.id));
}

/** Insert an additive/subtractive feature into its own history, before the next body. */
export function savePartFeature(project: Project, part: PartTab | undefined, feature: Feature, sketch?: Sketch): Project {
  const prior = project.features.findIndex((f) => f.id === feature.id);
  const sketches = sketch ? [...project.sketches, part ? { ...sketch, partId: part.id } : sketch] : project.sketches;
  if (prior >= 0) {
    return { ...project, sketches, features: project.features.map((f) => f.id === feature.id ? feature : f) };
  }
  if (!part) return { ...project, sketches, features: [...project.features, feature] };

  const start = project.features.findIndex((f) => f.id === part.id && f.operation === "new");
  if (start < 0) {
    if (!project.emptyParts?.some((p) => p.id === part.id) || feature.operation !== "new")
      throw Error("Create the first solid in this part before adding or cutting material.");
    return {
      ...project, sketches,
      emptyParts: project.emptyParts.filter((p) => p.id !== part.id),
      features: [...project.features, { ...feature, id: part.id }],
    };
  }
  if (feature.operation === "new") throw Error("Create a new part tab for a separate solid.");
  const next = project.features.findIndex((f, i) => i > start && f.operation === "new");
  const features = [...project.features];
  features.splice(next < 0 ? features.length : next, 0, { ...feature, bodyId: part.id });
  return { ...project, sketches, features };
}

/** Keep a reserved tab's identity when inserting hardware or imported geometry. */
export function organizePartInsertion(before: Project, after: Project, part?: PartTab): Project {
  if (!part) return after;
  const added = after.features.slice(before.features.length);
  const root = added.find((f) => f.operation === "new");
  if (!root) {
    return { ...after, sketches: [
      ...before.sketches, ...after.sketches.slice(before.sketches.length).map((s) => ({ ...s, partId: part.id })),
    ] };
  }
  if (!before.emptyParts?.some((p) => p.id === part.id)) return after;
  const workspaces = { ...after.workspaces };
  for (const key of ["bodyMaterials", "hardwareComponents"]) {
    const records = workspaces[key];
    if (records && Object.hasOwn(records, root.id)) {
      const updated = { ...records, [part.id]: records[root.id] };
      delete updated[root.id];
      workspaces[key] = updated;
    }
  }
  return {
    ...after, workspaces,
    emptyParts: before.emptyParts.filter((p) => p.id !== part.id),
    features: [...before.features, ...added.map((f) =>
      f.id === root.id ? { ...f, id: part.id, name: part.name }
        : f.bodyId === root.id ? { ...f, bodyId: part.id } : f,
    )],
  };
}
