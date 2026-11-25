import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
try {
  const guide = await server.ssrLoadModule("/src/penGuide.ts");
  const { validateProject, turnedProject } =
    await server.ssrLoadModule("/src/projects.ts");
  const { resolveParameters } = await server.ssrLoadModule(
    "/src/expressions.ts",
  );
  const {
    guidedPen,
    penGuide,
    setGuide,
    guideFeatureSaved,
    addGuideParts,
    recordGuideMotion,
    recordGuideClearance,
    recordGuideDrawing,
    refreshGuideCheck,
  } = guide;
  const original = turnedProject();
  assert.equal(penGuide(original), undefined);
  let project = guidedPen();
  assert.notEqual(project.id, original.id);
  assert.equal(penGuide(setGuide(project, { travel: "invalid" })), undefined);
  assert.equal(project.features.length, 0);
  project.parameters = project.parameters.map((p) =>
    p.name === "barrel_length" ? { ...p, expression: "4 in" } : p,
  );
  const barrel = {
    ...original.features[0],
    id: "user-created-revolve",
    name: "Custom barrel",
  };
  assert.equal(
    guideFeatureSaved(project, { ...barrel, amount: "90 deg" }),
    project,
  );
  project = guideFeatureSaved({ ...project, features: [barrel] }, barrel);
  assert.equal(penGuide(project).stage, "cap");
  const paused = setGuide(project, { paused: true });
  assert.equal(addGuideParts(paused), paused);
  const saved = validateProject(JSON.parse(JSON.stringify(paused)));
  project = addGuideParts(setGuide(saved, { paused: false }));
  assert.equal(project.features.length, 2);
  const joint = project.workspaces.joints["pen-cap"];
  assert.equal(joint.threadMate.mating.featureId, barrel.id);
  assert.equal(
    joint.threadMate.mating.finishId,
    project.features[0].finishes[0].id,
  );
  assert.equal(
    joint.threadMate.moving.finishId,
    project.features[1].finishes[0].id,
  );
  assert.equal(project.features[0].name, "Custom barrel");
  project = addGuideParts(project);
  assert.equal(project.features.length, 4);
  assert.equal(project.workspaces.joints["pen-refill"].parent, barrel.id);
  assert.equal(resolveParameters(project.parameters).barrel_length, 101.6);
  assert.equal(addGuideParts(project), project);
  assert.equal(recordGuideMotion(project, "pen-cap", 0, 0.75, true), project);
  assert.equal(
    recordGuideMotion(project, "pen-cap", 360, 0.75, false),
    project,
  );
  project = recordGuideMotion(project, "pen-cap", 360, 0.75, true);
  assert.equal(penGuide(project).travel, 0.75);
  const report = {
    id: "pen-cap",
    pair: barrel.id,
    status: "clear",
    lowerBound: 0.044,
  };
  assert.equal(recordGuideClearance(project, false, [report]), project);
  assert.equal(
    recordGuideClearance(project, true, [{ ...report, status: "unresolved" }]),
    project,
  );
  assert.equal(
    recordGuideClearance(project, true, [{ ...report, pair: "pen-clip" }]),
    project,
  );
  project = recordGuideClearance(project, true, [report]);
  assert.equal(penGuide(project).stage, "drawing");
  const drawing = guide.openGuideDrawing(project);
  assert.equal(refreshGuideCheck(project, drawing), drawing);
  assert.equal(drawing.workspaces.drawing.feature, barrel.id);
  const edited = refreshGuideCheck(drawing, {
    ...drawing,
    parameters: drawing.parameters.map((p) =>
      p.name === "barrel_length" ? { ...p, expression: "112 mm" } : p,
    ),
  });
  assert.equal(penGuide(edited).stage, "clearance");
  assert.equal(penGuide(edited).lowerBound, undefined);
  assert.equal(
    recordGuideDrawing(project, "profile", barrel.id, true),
    project,
  );
  assert.equal(
    recordGuideDrawing(project, "finished", "pen-cap", true),
    project,
  );
  assert.equal(
    recordGuideDrawing(project, "finished", barrel.id, false),
    project,
  );
  assert.equal(
    penGuide(recordGuideDrawing(project, "finished", barrel.id, true)).stage,
    "finished",
  );
  console.log(
    "Passed guided pen assembly, custom dimensions, saved progress, model-backed checkpoints and stale clearance invalidation.",
  );
} finally {
  await server.close();
}
