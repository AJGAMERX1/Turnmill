import { useMemo } from "react";
import { assemblyItemNumbers } from "./assemblyItems";
import { Download } from "lucide-react";
import { fileName, saveAs } from "./secondaryVector";
import type { EvaluatedFeature, Project } from "./types";
import { materials } from "./materials";
import { resolveParameters } from "./expressions";
import "./matingFits.css";
export type LibraryPart = {
  source: string;
  dimensions?: { label: string; parameter: string }[];
  specification?: string;
};
export function assemblyParts(project: Project, features: EvaluatedFeature[]) {
  const bodies = features.filter((f) => f.operation === "new"),
    names = new Map(bodies.map((b) => [b.id, b.name]));
  let values: Record<string, number> = {};
  try {
    values = resolveParameters(project.parameters);
  } catch {
    /* Invalid parameters are reported by the model rebuild. */
  }
  const numbers = assemblyItemNumbers(project);
  return bodies
    .map((body) => {
      const joint = project.workspaces?.joints?.[body.id];
      const library: LibraryPart | undefined =
        project.workspaces?.hardwareComponents?.[body.id];
      const materialName = project.workspaces?.bodyMaterials?.[body.id];
      const fallback = Object.hasOwn(
        materials,
        project.workspaces?.material ?? "",
      )
        ? project.workspaces!.material
        : "Brass";
      return {
        bodyId: body.id,
        item: numbers[body.id],
        name: body.name,
        quantity: 1,
        material: project.workspaces?.refills?.[body.id] ? "Ink, metal and polymer" : Object.hasOwn(materials, materialName ?? "")
          ? String(materialName)
          : String(fallback),
        joint: String(joint?.kind ?? "fixed"),
        parent: joint?.parent
          ? (names.get(joint.parent) ?? "Missing component")
          : "Ground",
        source:
          library?.source ??
          (body.kind === "import" ? "Imported body" : "Modeled part"),
        specification:
          library?.dimensions
            ?.map(
              ({ label, parameter }) =>
                label +
                " " +
                (Number.isFinite(values[parameter])
                  ? Number(values[parameter].toFixed(6)) + " mm"
                  : "(missing parameter)"),
            )
            .join(" · ") ??
          library?.specification ??
          "",
      };
    })
    .sort((a, b) => a.item - b.item);
}
export function bomCsv(rows: ReturnType<typeof assemblyParts>) {
  const quote = (v: string | number) =>
    '"' + String(v).replaceAll('"', '""') + '"';
  return [
    "Item,Component,Quantity,Joint,Parent,Material,Source,Specification",
    ...rows.map((r) =>
      [
        r.item,
        r.name,
        r.quantity,
        r.joint,
        r.parent,
        r.material,
        r.source,
        r.specification,
      ]
        .map(quote)
        .join(","),
    ),
  ].join("\r\n");
}
export default function AssemblyBom({
  project,
  features,
}: {
  project: Project;
  features: EvaluatedFeature[];
}) {
  const rows = useMemo(
    () => assemblyParts(project, features),
    [project, features],
  );
  return (
    <details className="assembly-bom">
      <summary>Bill of materials ({rows.length})</summary>
      <ol>
        {rows.map((r) => (
          <li key={r.item} value={r.item}>
            <strong>{r.name}</strong> × {r.quantity}
            <small>
              {r.material} · {r.source}
            </small>
            {r.specification && <small>{r.specification}</small>}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="tm-btn"
        onClick={() =>
          saveAs(
            bomCsv(rows),
            "text/csv;charset=utf-8",
            fileName(project.name) + "-BOM.csv",
          )
        }
      >
        <Download size={14} /> Download BOM
      </button>
    </details>
  );
}
