import { assemblyParts } from "./AssemblyBom";
import { drawingSources, partSheetKey } from "./drawingSheetSettings";
import {
  dimensionSnaps,
  formatDrawingLength,
  formatTolerance,
  measureDimension,
  orthographic,
  sectionSnaps,
  viewName,
  type DimensionGeometry,
  type FinishedDimension,
} from "./drawingDimensions";
import type { ViewSnaps } from "./FinishedDimensionDialog";
import { evaluate } from "./expressions";
import { assemblySheets, type AssemblyView } from "./secondaryAssemblySheet";
import {
  makeDrawing,
  type DrawingData,
  type Measure,
} from "./secondaryDrawing";
import {
  manufacturingSheets,
  type SheetOptions,
} from "./secondaryManufacturing";
import type { ProjectedBody, SectionAxis } from "./secondaryProjection";
import type { DrawingBase, DrawingCut } from "./preparedDrawing";
import type { EvaluatedFeature, Project } from "./types";

export type DrawingScope = "profile" | "finished" | "assembly";
export type Projection = {
  result?: ProjectedBody;
  assembly?: AssemblyView;
  error?: string;
};
const noDimensions: FinishedDimension[] = [];

export function drawingBody(features: EvaluatedFeature[], id?: string) {
  const start = features.findIndex((f) => f.id === id && f.operation === "new");
  if (start < 0) return [];
  const end = features.findIndex((f, i) => i > start && f.operation === "new");
  return features.slice(start, end < 0 ? undefined : end);
}

export function drawingDefinition(
  project: Project,
  features: EvaluatedFeature[],
  scope: DrawingScope,
  chosen?: EvaluatedFeature,
) {
  const cfg = project.workspaces?.drawing || {};
  const assembly = scope === "assembly";
  const bodies = features.filter((f) => f.operation === "new");
  const blocks = drawingSources(cfg, bodies[0]?.id);
  const blockKey = assembly ? "assembly" : partSheetKey(chosen?.id ?? "");
  const block = blocks[blockKey] ?? {};
  const annotations =
    (assembly
      ? cfg.assemblyAnnotations
      : cfg.annotations?.[chosen?.id ?? ""]) ?? {};
  const hasSection =
    scope === "finished" || (assembly && !!annotations.sectionEnabled);
  const sectionAxis: SectionAxis = hasSection
    ? annotations.sectionAxis || "Y"
    : "Y";
  const sectionOffset: string = hasSection
    ? annotations.sectionOffset || "0 mm"
    : "0 mm";
  const savedDims: FinishedDimension[] =
    annotations.finishedDimensions ?? noDimensions;
  const bom = assemblyParts(project, features);
  const part = bom.find((row) => row.bodyId === chosen?.id);
  const modelFeature = project.features.find((f) => f.id === chosen?.id);
  const sketch = project.sketches.find((s) => s.id === modelFeature?.sketchId);
  const keys = sketch?.points.map((p) => JSON.stringify([p.x, p.y])) ?? [];
  const measures: Measure[] = cfg.measures?.[chosen?.id ?? ""] ?? [];
  const data: DrawingData = {
    title:
      block.title ??
      (assembly || bodies.length < 2 ? project.name : chosen?.name) ??
      project.name,
    number:
      block.number ??
      (assembly ? "TM-A01" : "TM-" + String(part?.item || 1).padStart(3, "0")),
    revision: block.revision ?? "A",
    material: block.material ?? (assembly ? "" : (part?.material ?? "")),
    note: block.note ?? "",
    dimensions: cfg.dimensions !== false,
    hatch: cfg.hatch !== false,
    scale: block.scale && block.scale !== "auto" ? Number(block.scale) : "auto",
    measures,
  };
  return {
    cfg,
    scope,
    chosen,
    assembly,
    blocks,
    blockKey,
    block,
    annotations,
    hasSection,
    sectionAxis,
    sectionOffset,
    savedDims,
    bom,
    keys,
    data,
  };
}

export function drawingDimensionViews(
  projected: Projection | null | undefined,
): DimensionGeometry | undefined {
  const assembly = projected?.assembly;
  return (
    projected?.result?.views ??
    (assembly
      ? { ...assembly.views, section: assembly.section?.view }
      : undefined)
  );
}

export function drawingSnaps(
  views: DimensionGeometry | undefined,
  project: Project,
  body: EvaluatedFeature[],
  assembly: boolean,
  sectionAxis: SectionAxis,
  sectionOffset: number,
): ViewSnaps {
  if (!views) return { front: [], top: [], right: [], section: [] };
  const [front, top, right] = orthographic.map((view) =>
    dimensionSnaps(view, views[view], body, project, !assembly),
  );
  return {
    front,
    top,
    right,
    section: views.section
      ? sectionSnaps(
          views.section,
          sectionAxis,
          sectionOffset,
          project,
          assembly,
        )
      : [],
  };
}

export function drawingDetailWidth(views?: DimensionGeometry) {
  const bounds = views?.section?.bounds;
  return bounds && bounds[1][0] > bounds[0][0]
    ? formatDrawingLength((bounds[1][0] - bounds[0][0]) / 4) + " mm"
    : "8 mm";
}

/** Compose the same sheets for the Drawing workspace, its PDF, and a delivery package. */
export function linkedDrawingSheets(
  definition: ReturnType<typeof drawingDefinition>,
  body: EvaluatedFeature[],
  values: Record<string, number>,
  projected: Projection | null,
  snaps: ViewSnaps,
) {
  const {
    cfg,
    scope,
    chosen,
    data,
    keys,
    hasSection,
    block,
    annotations,
    savedDims,
    bom,
  } = definition;
  if (!chosen && scope !== "assembly") {
    throw Error(
      cfg.feature
        ? "The linked body was removed or suppressed. Choose an available source."
        : "Create or import a solid body to generate a linked drawing.",
    );
  }
  if (scope === "profile") {
    if (!chosen) throw Error("Select a source body.");
    if (chosen.kind === "import")
      throw Error(
        "This imported body has no editable base profile. Select Finished body to draw it.",
      );
    if (
      data.measures.some(
        (m) =>
          !keys[m.a] ||
          !keys[m.b] ||
          keys[m.a] !== m.keyA ||
          keys[m.b] !== m.keyB,
      )
    )
      throw Error(
        "A dimension references an edited or missing sketch point. Remove that dimension and select its endpoints again.",
      );
    const { sheet, scale } = makeDrawing(chosen, data);
    return { sheets: [{ label: "Base feature", sheet, scale }], scale };
  }
  if (scope === "assembly" && !bom.length)
    throw Error(
      "Create or import at least one solid body to draw an assembly.",
    );
  if (projected?.error) throw Error(projected.error);
  if (!projected?.result && !projected?.assembly)
    throw Error(
      scope === "assembly"
        ? "Projecting the assembled components…"
        : "Projecting the finished solid…",
    );

  const tol = block.tolerance ? evaluate(block.tolerance, values) : 0;
  if (tol < 0)
    throw Error("Use a nonnegative general tolerance, or clear the field.");
  const tolerance = tol > 0 ? formatTolerance(tol) : "";
  const views = drawingDimensionViews(projected);
  const options: SheetOptions = {
    manualDimensions: savedDims.map((dimension, i) => {
      try {
        if (dimension.view === "section" && !views?.section)
          throw Error(
            "Enable the assembly section or edit this dimension and choose another view.",
          );
        return measureDimension(dimension, snaps[dimension.view] || [], values);
      } catch (error) {
        throw Error(
          "Dimension " +
            (i + 1) +
            " · " +
            viewName(dimension.view) +
            ". " +
            (error as Error).message,
        );
      }
    }),
  };
  if (hasSection && block.detail)
    options.detail = {
      end: block.detailEnd === "start" ? "start" : "end",
      width: evaluate(block.detailWidth ?? drawingDetailWidth(views), values),
    };
  if (scope === "assembly") {
    if (!projected.assembly)
      throw Error("Projecting the assembled components…");
    return {
      scale: 1,
      sheets: assemblySheets(projected.assembly, data, bom, {
        ...options,
        tolerance,
        section: projected.assembly.section,
        axis: cfg.explodeAxis || "joints",
        gap: cfg.explodeGap ? evaluate(cfg.explodeGap, values) : undefined,
      }),
    };
  }
  if (!projected.result) throw Error("Projecting the finished solid…");
  if (annotations.form)
    options.form = {
      kind:
        annotations.formKind === "straightness" ? "straightness" : "roundness",
      key: annotations.formKey || "",
      value: evaluate(String(annotations.formValue ?? "0.01 mm"), values),
    };
  if (annotations.datum)
    options.datum = {
      key: annotations.datumKey || "",
      letter: annotations.letter || "A",
    };
  return manufacturingSheets(projected.result, data, body, tolerance, options);
}

export function combineProjection(
  base: DrawingBase,
  cut: DrawingCut,
): Projection | null {
  if ("part" in base && "part" in cut) {
    const { section: profile, ...station } = cut.part;
    return {
      result: {
        ...base.part,
        ...station,
        views: { ...base.part.views, section: profile },
      },
    };
  }
  if ("assembly" in base && "assembly" in cut)
    return { assembly: { ...base.assembly, section: cut.assembly } };
  return null;
}
