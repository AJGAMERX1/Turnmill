type TextSetting =
  | "title"
  | "number"
  | "revision"
  | "material"
  | "note"
  | "tolerance"
  | "detailWidth"
  | "detailEnd"
  | "scale";
export type DrawingSheetSettings = Partial<
  Record<TextSetting, string> & { detail: boolean }
>;
export const partSheetKey = (id: string) => "body:" + id;

// Earlier files stored one part block and an optional assembly title. Capture
// the selected part before a source switch so its tolerances follow that part.
export function drawingSources(
  config: Record<string, unknown>,
  firstBodyId?: string,
): Record<string, DrawingSheetSettings> {
  if (config.sources && typeof config.sources === "object")
    return config.sources as Record<string, DrawingSheetSettings>;
  const sources: Record<string, DrawingSheetSettings> = {};
  const original =
    typeof config.feature === "string" && config.feature
      ? config.feature
      : firstBodyId;
  if (original) {
    const part: DrawingSheetSettings = {};
    for (const key of [
      "title",
      "number",
      "revision",
      "material",
      "note",
      "tolerance",
      "detailWidth",
      "detailEnd",
      "scale",
    ] as const) {
      const value = config[key];
      if (typeof value === "string" || typeof value === "number")
        part[key] = String(value);
    }
    if (typeof config.detail === "boolean") part.detail = config.detail;
    if (Object.keys(part).length) sources[partSheetKey(original)] = part;
  }
  const assembly: DrawingSheetSettings = {};
  if (typeof config.assemblyTitle === "string")
    assembly.title = config.assemblyTitle;
  if (typeof config.assemblyScale === "string")
    assembly.scale = config.assemblyScale;
  if (Object.keys(assembly).length) sources.assembly = assembly;
  return sources;
}
