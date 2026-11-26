import { evaluateAdvanced } from "./advancedTypes";
import { getImportedBrep } from "./exchangeTypes";
import { evaluateScaleStock } from "./secondaryEngraving";
import type { EvaluatedFeature, Feature, Project } from "./types";
import { evaluate, resolveParameters } from "./expressions";
import { evaluateFinish } from "./finishingTypes";
import { validateProjectScrewCones } from "./screwConeProfile";
import { solveSketch } from "./solveSketch";
import { prepareRefillSketch, refillTipX, type RefillComponent } from "./refills";
export async function evaluateModel(
  p: Project,
): Promise<{ features: EvaluatedFeature[]; values: Record<string, number> }> {
  const values = resolveParameters(p.parameters);
  validateProjectScrewCones(p, values);
  const cache = new Map<string, Awaited<ReturnType<typeof solveSketch>>>();
  const features = await evaluateHistory(p, p.features, values, cache);
  return { values, features };
}

async function evaluateHistory(
  project: Project,
  history: Feature[],
  values: Record<string, number>,
  cache: Map<string, Awaited<ReturnType<typeof solveSketch>>>,
  toolRefill?: RefillComponent,
): Promise<EvaluatedFeature[]> {
  // A merged cartridge loses its independent mass and motion. Its source profile
  // still needs the cartridge's original dimension checks and tip orientation.
  const refills = history.flatMap(f => f.merge?.targetRefill ? [f.merge.targetRefill] : []);
  if (toolRefill) refills.push(toolRefill);
  const p = refills.length ? { ...project, workspaces: {
    ...project.workspaces, refills: { ...project.workspaces?.refills,
      ...Object.fromEntries(refills.map(r => [r.bodyId, r])) },
  } } : project;
  const features: EvaluatedFeature[] = [];
  let body = "", flip = 0;
  function finishRefill() {
    if (flip > 0) features[features.length - 1].reverseRefillLength = flip;
    flip = 0;
  }
  for (const feature of history) {
    // Finish the retained input in its displayed orientation immediately before
    // the union. Suppressing the union must also leave that input correctly posed.
    if (feature.kind === "merge" && feature.merge?.targetRefill?.bodyId === body) finishRefill();
    if (feature.suppressed) continue;
    if (feature.operation === "new") {
      finishRefill();
      body = feature.id;
      flip = refillTipX(p, body, values);
    } else if (!body || (feature.bodyId && feature.bodyId !== body)) {
      throw Error(
        feature.name +
          " needs its original body earlier in the history. Move it back, or restore the body.",
      );
    }
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
    if (feature.kind === "merge") {
      if (!feature.merge || feature.operation !== "add")
        throw Error(feature.name + " is missing its source part. Undo the merge and select two parts again.");
      const source = await evaluateHistory(project, feature.merge.features, values, cache, feature.merge.toolRefill);
      features.push({
        id: feature.id, name: feature.name, kind: "merge", operation: "add",
        merge: { features: source, transform: feature.merge.transform },
        finishes, advanced, operations, amount: 0, points: [],
      });
      continue;
    }
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
  finishRefill();
  return features;
}
