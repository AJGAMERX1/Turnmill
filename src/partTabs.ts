import type { Feature, PartTab, Project, Sketch } from "./types";

// The New body feature is the document identity used by assembly and export.
// Only parts awaiting their first solid need an additional project entry.
export function projectPartTabs(project: Project): PartTab[] {
  return [
    ...project.features.filter((f) => f.operation === "new").map(({ id, name }) => ({ id, name })),
    ...(project.emptyParts ?? []),
  ];
}

export function partFeatures(project: Project, partId: string): Feature[] {
  let owner: string | undefined;
  return project.features.filter((f) => {
    if (f.operation === "new") {
      owner = f.id;
      return f.id === partId;
    }
    return (f.bodyId ?? owner) === partId;
  });
}

export function partSketches(project: Project, partId: string, features: Feature[]): Sketch[] {
  const used = new Set(features.map((f) => f.sketchId));
  for (const f of features) {
    const operations = f.operations?.map((entry) => entry.operation) ?? (f.advanced ? [f.advanced] : []);
    for (const op of operations) {
      if (op.kind === "loft") { used.add(op.lowerId); used.add(op.upperId); }
      if (op.kind === "sweep") { used.add(op.pathId); used.add(op.sectionId); }
    }
  }
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
