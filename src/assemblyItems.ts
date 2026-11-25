import type { Project } from "./types";

export function assemblyItemNumbers(
  project: Project,
  previous?: Record<string, number>,
) {
  const saved = project.workspaces?.assemblyItems ?? previous ?? {};
  const items = new Map<string, number>(),
    used = new Set<number>();
  let highest = 0;
  for (const [id, value] of Object.entries(saved)) {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      !used.has(value)
    ) {
      items.set(id, value);
      used.add(value);
      highest = Math.max(highest, value);
    }
  }
  // Reserve numbers for suppressed and formerly assigned bodies as well.
  for (const body of project.features) {
    if (body.operation === "new" && !items.has(body.id))
      items.set(body.id, ++highest);
  }
  return Object.fromEntries(items);
}

export function keepAssemblyItems(previous: Project, next: Project): Project {
  const items = assemblyItemNumbers(
    next,
    previous.id === next.id ? assemblyItemNumbers(previous) : undefined,
  );
  const stored = next.workspaces?.assemblyItems;
  if (
    !Object.keys(items).length ||
    (stored &&
      Object.keys(items).length === Object.keys(stored).length &&
      Object.keys(items).every((id) => items[id] === stored[id]))
  )
    return next;
  return { ...next, workspaces: { ...next.workspaces, assemblyItems: items } };
}
