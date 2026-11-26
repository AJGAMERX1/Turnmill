import { drawingPdf } from "./drawingPdf";
import { loadDrawingFont } from "./drawingFont";
import { evaluate, resolveParameters } from "./expressions";
import { hasModeledThread } from "./finishingTypes";
import { buildBodies, releaseBodies, type Body } from "./geometry";
import {
  combineProjection,
  drawingBody,
  drawingDefinition,
  drawingDimensionViews,
  drawingSnaps,
  linkedDrawingSheets,
} from "./linkedDrawing";
import { cosmeticThreads, prepareDrawing } from "./preparedDrawing";
import type { EvaluatedFeature, Project } from "./types";

export type PackageDrawingRequest = { bodyId: string | null; filename: string };

/** Run in the initialized delivery worker. The caller owns the exact solids. */
export async function createPackageDrawings(
  project: Project,
  features: EvaluatedFeature[],
  requests: PackageDrawingRequest[],
  onProgress:
    | ((completed: number, total: number, name: string) => void)
    | undefined,
  bodies: Body[],
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = Object.create(null);
  if (!requests.length) return files;
  const roots = features.filter((f) => f.operation === "new");
  if (roots.length !== bodies.length)
    throw Error(
      "The drawing sources changed. Rebuild the project and export again.",
    );
  const histories = roots.map((root) => drawingBody(features, root.id));
  const values = resolveParameters(project.parameters);
  const font = await loadDrawingFont();
  const cosmeticBodies = new Map<number, Body>();
  function drawingSolid(index: number): Body {
    if (!histories[index].some(hasModeledThread)) return bodies[index];
    const cached = cosmeticBodies.get(index);
    if (cached) return cached;
    const [simplified] = buildBodies(histories[index].map(cosmeticThreads));
    cosmeticBodies.set(index, simplified);
    return simplified;
  }
  try {
    for (const [index, request] of requests.entries()) {
      const { bodyId, filename } = request;
      const assembly = bodyId === null;
      const partIndex = roots.findIndex((root) => root.id === bodyId);
      const part = roots[partIndex];
      if (!assembly && !part)
        throw Error(
          "The selected drawing part is missing. Select an available part and export again.",
        );
      if (Object.hasOwn(files, filename))
        throw Error("Two drawings have the same output filename.");
      const title = assembly ? "Assembly" : part.name;
      try {
        onProgress?.(index, requests.length, title);
        const source = assembly ? features : histories[partIndex];
        const definition = drawingDefinition(
          project,
          features,
          assembly ? "assembly" : "finished",
          part,
        );
        const modeled =
          definition.cfg.modeled === true || definition.savedDims.length > 0;
        const simplified = !modeled && source.some(hasModeledThread);
        const plane = definition.hasSection
          ? {
              axis: definition.sectionAxis,
              offset: evaluate(definition.sectionOffset, values),
            }
          : undefined;
        const drawing = prepareDrawing(
          {
            features: source,
            values,
            modeled,
            joints: assembly ? (project.workspaces?.joints ?? {}) : undefined,
          },
          {
            exact: assembly ? bodies : [bodies[partIndex]],
            simplified: simplified
              ? assembly
                ? roots.map((_, i) => drawingSolid(i))
                : [drawingSolid(partIndex)]
              : undefined,
          },
        );
        try {
          const projection = combineProjection(
            drawing.base,
            drawing.cut(plane),
          );
          const views = definition.savedDims.length
            ? drawingDimensionViews(projection)
            : undefined;
          const offset =
            projection?.result?.sectionOffset ??
            projection?.assembly?.section?.offset ??
            0;
          const snaps = drawingSnaps(
            views,
            project,
            source,
            assembly,
            definition.sectionAxis,
            offset,
          );
          const { sheets } = linkedDrawingSheets(
            definition,
            source,
            values,
            projection,
            snaps,
          );
          const pages = sheets.map((sheet) => sheet.sheet);
          const { cfg, data } = definition;
          const openProfile =
            cfg.scope === "profile" && (cfg.feature ?? roots[0]?.id) === bodyId;
          if (!assembly && (data.measures.length > 0 || openProfile)) {
            // Base-profile measurements refer to the original sketch. Keep their reference
            // points and title on a separate sheet from the projections of the finished solid.
            const profile = linkedDrawingSheets(
              { ...definition, scope: "profile" },
              source,
              values,
              null,
              snaps,
            );
            pages.push(...profile.sheets.map((sheet) => sheet.sheet));
          }
          files[filename] = await drawingPdf(
            pages,
            definition.data.title,
            font,
          );
        } finally {
          drawing.dispose();
        }
      } catch (error) {
        throw Error(
          title +
            " drawing — " +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    onProgress?.(requests.length, requests.length, "Drawings ready");
    return files;
  } finally {
    releaseBodies([...cosmeticBodies.values()]);
  }
}
