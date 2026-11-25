import { captureViewport } from "./capture.mjs";
import { openBrowser, appUrl, measure } from "./browser.mjs";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const fixture = resolve("test-evidence/ASM-001/two-blocks.turnmill");
const dir = resolve(process.env.QA_PLACEMENT_OUT || "test-evidence/ASM-001");
await mkdir(dir, { recursive: true });
const browser = await openBrowser({ displayEvidence: true });
try {
  const p = await browser.newPage({ viewport: { width: 1400, height: 930 }, acceptDownloads: true });
  p.setDefaultTimeout(80000);
  const button = (name) => p.getByRole("button", { name, exact: true });
  async function open(file) {
    await p.getByLabel("Open Turnmill project file").setInputFiles(file);
    await p.waitForFunction(() => document.querySelector(".status-bar")?.innerText.includes("2 bodies"));
    await button("Assembly").click();
    await button("3D assembly").click();
    await p.getByLabel("Component", { exact: true }).selectOption("upper");
    await p.locator(".joint-stage .joint-message").waitFor({ state: "hidden" });
  }
  async function exportFiles(stem, scope) {
    for (const [format, name] of [["step", /STEP solid/], ["stl", /STL mesh/], ["3mf", /3MF model/]]) {
      await button("Export").click();
      await p.getByLabel("Export geometry").selectOption(scope);
      const next = p.waitForEvent("download");
      await p.getByRole("button", { name }).click();
      const file = await next;
      if (scope === "selected") assert.equal(file.suggestedFilename(), "Upper block." + format);
      await file.saveAs(join(dir, stem + "." + format));
    }
  }
  await p.goto(appUrl);
  await measure(p);
  await open(fixture);
  const seated = await measure(p);
  assert.equal(seated.joints.matrices[1][14], 20);
  await captureViewport(p, join(dir, "seated-assembly.png"));
  await exportFiles("two-blocks", "all");

  const driven = JSON.parse(await readFile(fixture));
  driven.id += "-live";
  driven.features[1].amount = "3 mm";
  driven.workspaces.joints.b = { ...driven.workspaces.joints.upper, parent: "", offset: ["3", "4", "0"] };
  Object.assign(driven.workspaces.joints.upper, { kind: "revolute", max: "180 deg" });
  await open({ name: "live.turnmill", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(driven)) });
  const drive = p.getByLabel("Drive value", { exact: true });
  await drive.fill("90 deg");
  await drive.press("Enter");
  await p.waitForFunction(async () => (await window.__cadTest.snapshot()).joints?.current === 90);
  const live = await measure(p);
  assert.equal(live.project.workspaces.jointPose?.upper?.[0] ?? 0, 0);
  await exportFiles("unsaved-quarter-turn", "all");
  await exportFiles("upper-part", "selected");
  await button("Part").click();
  await exportFiles("local-parts", "all");
  await writeFile(join(dir, "native.json"), JSON.stringify({
    seated: seated.joints.matrices,
    live: live.joints.matrices,
    workpiece: live.bodies,
    savedAngle: 0,
    visibleAngle: 90,
  }, null, 2));
} finally {
  await browser.close();
}
