import { evaluateAdvanced } from "./advancedTypes";
import { getImportedBrep } from "./exchangeTypes";
import { evaluateScaleStock } from "./secondaryEngraving";
import type { EvaluatedFeature, Project } from "./types";
import { evaluate, resolveParameters } from "./expressions";
import { evaluateFinish } from "./finishingTypes";
import { solveSketch } from "./solveSketch";
import { prepareRefillSketch, refillTipX } from "./refills";
export async function evaluateModel(
  p: Project,
): Promise<{ features: EvaluatedFeature[]; values: Record<string, number> }> {
  const values = resolveParameters(p.parameters),
    features: EvaluatedFeature[] = [];
  const cache = new Map<string, Awaited<ReturnType<typeof solveSketch>>>();
  let body = "";
  for (const feature of p.features) {
    if (feature.suppressed) continue;
    if (feature.operation === "new") body = feature.id;
    else if (!body || (feature.bodyId && feature.bodyId !== body))
      throw Error(
        feature.name +
          " needs its original body earlier in the history. Move it back, or restore the body.",
      );
    const advanced = feature.advanced
      ? await evaluateAdvanced(feature.advanced, p, values)
      : undefined;
    const operations = feature.operations
      ? await Promise.all(
          feature.operations
            .filter((x) => !x.suppressed)
            .map((x) => evaluateAdvanced(x.operation, p, values)),
        )
      : undefined;
    const finishes = feature.finishes
      ?.filter((f) => !f.suppressed)
      .map((f) => evaluateFinish(f, values));
    if (feature.kind === "import") {
      features.push({
        id: feature.id,
        name: feature.name,
        kind: "import",
        operation: "new",
        points: [],
        amount: 0,
        brep: getImportedBrep(feature, p.importedFiles),
        finishes,
        advanced,
        operations,
      });
      continue;
    }
    const scale = evaluateScaleStock(p, values, feature);
    if (scale) {
      features.push({ ...scale, finishes, advanced, operations });
      continue;
    }
    const sketch = p.sketches.find((s) => s.id === feature.sketchId);
    if (!sketch)
      throw Error(
        feature.name + " needs a profile. Edit the feature to choose one.",
      );
    let solved = cache.get(sketch.id);
    if (!solved) {
      solved = await solveSketch(prepareRefillSketch(p, feature.id, sketch, values), values);
      cache.set(sketch.id, solved);
    }
    const amount = evaluate(
      feature.amount,
      values,
      feature.kind === "revolve" ? "angle" : "length",
    );
    features.push({
      id: feature.id,
      name: feature.name,
      kind: feature.kind,
      operation: feature.operation,
      amount,
      advanced,
      operations,
      finishes,
      points: solved.points.map((q) => [q.x, q.y]),
      edges: solved.edges,
    });
  }
  // Keep all sketch constraints, cuts and finishes in their design coordinates.
  // A terminal marker also distinguishes a completed flipped body from a reusable unflipped prefix.
  let last = features.length - 1;
  for (let i = last; i >= 0; i--) {
    if (features[i].operation !== "new") continue;
    const tip = refillTipX(p, features[i].id, values);
    if (tip > 0) features[last].reverseRefillLength = tip;
    last = i - 1;
  }
  return { values, features };
}
