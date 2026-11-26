// Run all suites to retain independent failure evidence. Unexpected outcomes make the process fail.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { serveBuild } from "./serve.mjs";
const env = { ...process.env },
  results = [];
const evidence = "test-evidence/runner";
await mkdir(evidence, { recursive: true });
await mkdir("test-evidence/browser", { recursive: true });
// A successful reader must consume this run's exports, never the checked-in evidence.
env.QA_INTEROP_OUT ||= await mkdtemp(resolve(evidence,"interop-"));
env.TURNMILL_PROJECT_EVIDENCE ||= await mkdtemp(resolve(evidence,"projects-"));
let py = env.QA_PYTHON || "python3";
if (!env.QA_PYTHON) {
  try {
    await access("../interop-tools/py/bin/python");
    py = resolve("../interop-tools/py/bin/python");
  } catch {}
}
async function run(name, argv, extra = {}, limit = 40 * 60 * 1000) {
  const start = Date.now(),
    log = createWriteStream(evidence + "/" + name + ".log");
  const status = await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      env: { ...env, ...extra },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ended = false;
    const terminate = (signal) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {}
    };
    const timeout = setTimeout(() => terminate("SIGKILL"), limit);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const finish = (code) => {
      if (ended) return;
      ended = true;
      clearTimeout(timeout);
      resolve(code);
    };
    child.on("error", (e) => {
      log.write(String(e));
      finish("spawn error");
    });
    child.on("close", (code, signal) => finish(code ?? signal));
  });
  await new Promise((r) => log.end(r));
  results.push({ suite: name, exit: status, ms: Date.now() - start });
  await writeFile(evidence + "/results.json", JSON.stringify(results, null, 2));
  console.log(name, status === 0 ? "PASS" : "FAIL", status);
  return status === 0;
}
if (env.TURNMILL_X11_EVIDENCE === "1" &&
    !(await run("x11-viewport", ["node", "tests/qa/check-x11-viewport.mjs"]))) process.exit(1);
if (
  !(await run("production-build", ["npm", "run", "build"], {
    VITE_CAD_QA: "1",
  }))
)
  process.exit(1);
const server = await serveBuild();
Object.assign(env, {
  TURNMILL_URL: server.url,
  TURNMILL_QA_URL: server.url,
  QA_URL: server.url,
});
try {
  await run("baseline", ["npm", "test"]);
  await run("test-hook", ["node", "tests/qa/hook.mjs"]);
  for (const name of ["precision-sketch", "pen-studio", "grip-milling", "thread-ends", "refill-threads", "native-import", "bic-donor", "refill-snap", "writing-fit", "shop-package", "merge-parts"]) await run(name, ["node", "tests/qa/" + name + ".mjs"]);
  await run("bolt-pen-controls", ["node", "tests/browser/bolt-pen.mjs"]);
  await run("flush-fine-cap", ["node", "tests/qa/flush-fine-cap.mjs"]);
  await run("screw-cone-bore", ["node", "tests/qa/screw-cone-bore.mjs"]);
  await run("inspector-dimensions", ["node", "tests/qa/inspector-dimensions.mjs"]);
  await run("projects", ["node", "tests/projects/run.mjs"], {}, 65 * 60000);
  const m10 = await mkdtemp(resolve(evidence, "projects-m10-"));
  if (await run("m10-acceptance", ["node", "tests/projects/m10-acceptance.mjs"], {
    TURNMILL_PROJECT_EVIDENCE: m10,
  })) {
    await run("m10-acceptance-proof", [
      env.QA_PDF_PYTHON || py, "tests/qa/m10-acceptance.py", resolve(m10, "m10-acceptance"),
    ]);
  }
  await run(
    "systems",
    ["node", "tests/systems/run.mjs"],
    {
      QA_SYSTEM_BROWSER: "1",
      QA_EXPORT_SYS002: resolve(env.QA_INTEROP_OUT || "test-evidence/interop"),
    },
    Number(env.QA_FUZZ_MS || 35000) + 35 * 60000,
  );
  for (const name of ["mobile", "palette", "history"])
    await run(name, ["node", "tests/browser/" + name + ".cjs"]);
  await run("shortcuts", ["node", "tests/browser/shortcuts.mjs"]);
  await run("drawing-export", ["node", "tests/qa/drawings.mjs"]);
  await run("pdf-review", [env.QA_PDF_PYTHON || py, "tests/qa/pdf-review.py"]);
  const rulers = await mkdtemp(resolve(evidence, "ruler-export-"));
  if (await run("ruler-export", ["node", "tests/qa/ruler-export.mjs"], { QA_RULER_EXPORT_OUT: rulers }))
    await run("ruler-export-step", [py, "tests/freecad/runner.py", "ruler-export"], { QA_INTEROP_OUT: rulers });
  const workspaces = await mkdtemp(resolve(evidence, "part-workspaces-"));
  if (await run("part-workspaces", ["node", "tests/qa/part-workspaces.mjs"], { QA_PART_WORKSPACES_OUT: workspaces }))
    await run("part-workspaces-step", [py, "tests/freecad/runner.py", "part-workspaces"], { QA_INTEROP_OUT: workspaces });
  if (await run("assembly-export", ["node", "tests/qa/placement.mjs"]))
    await run("assembly-step", [py, "tests/qa/check-placement.py"]);
  await run(
    "interop",
    [py, "tests/interop/run.py", "--headless"],
    {},
    70 * 60000,
  );
  await run("approved-reference-values", ["node", "tests/qa/approved.mjs"]);
} finally {
  server.close();
}
if (await run("release-build", ["npm", "run", "build"], { VITE_CAD_QA: "0" })) {
  if (await run("pages-subpath", ["node", "tests/qa/pages-smoke.mjs"])) {
    await run("pages-step-volume", [py, "tests/qa/pages-volume.py"]);
  }
}
if (results.some((r) => r.exit !== 0)) process.exitCode = 1;
