export type ImportFormat = "step" | "stl" | "dxf" | "svg" | "turnmill";
export type FileUnit = "mm" | "in";
export type StoredBody = { name: string; brep: string };
export type ImportedFile = {
  id: string;
  name: string;
  format: ImportFormat;
  /** Original file bytes, as base64 without a data URL prefix. */
  data: string;
  unit?: FileUnit;
  bodies?: StoredBody[];
  sketchIds?: string[];
};

export function asBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result);
      resolve(raw.slice(raw.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(
        new Error("The selected file could not be read. Choose it again."),
      );
    reader.readAsDataURL(file);
  });
}

export function fileFormat(filename: string): ImportFormat {
  const ext = filename.split(".").at(-1)?.toLowerCase();
  if (ext === "turnmil" || ext === "turnmill") return "turnmill";
  if (ext === "stp" || ext === "step") return "step";
  if (ext === "stl" || ext === "svg" || ext === "dxf") return ext;
  throw new Error("Choose a Turnmill project (.turnmill or .turnmil), STEP, STL, DXF, or SVG file.");
}

export function validateImportedFiles(
  value: unknown,
): asserts value is ImportedFile[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value))
    throw new Error("The project’s imported file list is damaged.");
  const ids = new Set<string>();
  for (const source of value) {
    if (
      !source ||
      typeof source.id !== "string" ||
      !source.id ||
      ids.has(source.id) ||
      typeof source.name !== "string" ||
      typeof source.data !== "string" ||
      !source.data.length ||
      !["step", "stl", "svg", "dxf", "turnmill"].includes(source.format)
    )
      throw new Error(
        "An imported source is missing its name, file data, or format.",
      );
    if (source.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.data))
      throw new Error("The embedded data for " + source.name + " is damaged.");
    if (
      source.unit !== undefined &&
      source.unit !== "mm" &&
      source.unit !== "in"
    )
      throw new Error("The source units for " + source.name + " are invalid.");
    if (source.format === "step" || source.format === "stl" || source.format === "turnmill") {
      if (
        !Array.isArray(source.bodies) ||
        !source.bodies.length ||
        source.bodies.some(
          (body: StoredBody) =>
            !body ||
            typeof body.brep !== "string" ||
            !body.brep.trim() ||
            typeof body.name !== "string",
        )
      )
        throw new Error(
          "The solid geometry from " + source.name + " is incomplete.",
        );
    } else if (
      !Array.isArray(source.sketchIds) ||
      !source.sketchIds.every((id: unknown) => typeof id === "string")
    )
      throw new Error(
        "The imported profile references for " + source.name + " are damaged.",
      );
    ids.add(source.id);
  }
}

export function getImportedBrep(
  feature: { name: string; sourceId?: string; sourceIndex?: number },
  files?: ImportedFile[],
): string {
  const source = files?.find((file) => file.id === feature.sourceId);
  if (!source)
    throw new Error("The source file for " + feature.name + " is missing.");
  const index = feature.sourceIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || !source.bodies?.[index])
    throw new Error(
      "The solid for " + feature.name + " is missing from " + source.name + ".",
    );
  return source.bodies[index].brep;
}
