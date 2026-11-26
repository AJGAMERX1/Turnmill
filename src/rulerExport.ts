import { resolveParameters } from "./expressions";
import { getScaleLayout } from "./secondaryEngraving";
import { makeScale, outlinedGraduations } from "./secondaryScale";
import { dxfFile, fileName, saveAs, svgFile } from "./secondaryVector";
import type { Project } from "./types";

export type RulerExportOptions = { include: boolean; centerlines: boolean };
export type RulerTool = "part" | "stock";

export function prepareRulerExport(project: Project, options: RulerExportOptions) {
  try {
    const layout = getScaleLayout(project.workspaces?.scale ?? {}, resolveParameters(project.parameters));
    const results = makeScale(layout);
    const preview = outlinedGraduations(results.preview, layout);
    const source = options.include ? results.preview : results.geometry;
    const sheet = options.centerlines ? source : options.include ? preview : outlinedGraduations(source, layout);
    const kind = layout.layout === "arc" ? "protractor" : "ruler";
    const projectName = fileName(project.name);
    const base = projectName.toLowerCase().endsWith(kind) ? projectName : projectName + "-" + kind;
    return { layout, results, preview, sheet, base, error: "" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
export type RulerExport = ReturnType<typeof prepareRulerExport>;

export function downloadRulerVector(result: RulerExport, format: "svg" | "dxf") {
  if (!result.sheet) throw Error(result.error || "Correct the ruler dimensions before exporting.");
  if (format === "svg") saveAs(svgFile(result.sheet), "image/svg+xml", result.base + ".svg");
  else saveAs(dxfFile(result.sheet), "application/dxf", result.base + ".dxf");
}

export function rulerSolidId(project: Project, tool: RulerTool): string | undefined {
  const cfg = project.workspaces?.scale;
  if (!cfg) return;
  const active = project.features.filter((f) => !f.suppressed);
  const target = tool === "stock" ? cfg.modelId : active.find((f) => f.id === cfg.appliedId && f.operation === "cut")?.bodyId;
  return active.find((f) => f.id === target && f.operation === "new")?.id;
}
