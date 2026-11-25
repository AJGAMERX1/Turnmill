import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const evidence = resolve(
  process.env.TURNMILL_QA_EVIDENCE || "test-evidence/systems",
);
const fuzzMs = Number(process.env.QA_FUZZ_MS ?? 35000);
if (!Number.isFinite(fuzzMs) || fuzzMs < 1)
  throw Error("QA_FUZZ_MS must be positive");
const checks = [
  ["sketch", 20000],
  ["geometry", 150000],
  ["motion", 90000],
  ["findings", 90000],
  ["parameters-history", 60000],
  ["performance", 180000],
  ["fuzz", fuzzMs + 120000],
];
if (process.env.QA_SYSTEM_BROWSER === "1")
  checks.push(
    ["browser", 150000],
    ["performance-browser", 160000],
    ["sketch-undo-browser", 160000],
    ["editor-browser", 160000],
  );
const results = [];
await mkdir(evidence, { recursive: true });
for (const [name, timeoutMs] of checks) {
  const t = Date.now(),
    child = spawn(process.execPath, ["tests/systems/" + name + ".mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  let log = "",
    timedOut = false;
  const receive = (chunk) => {
    process.stdout.write(chunk);
    log += chunk.toString();
  };
  child.stdout.on("data", receive);
  child.stderr.on("data", receive);
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  clearTimeout(timeout);
  const row = {
    suite: name,
    outcome: code === 0 ? "Pass" : "Fail",
    durationMs: Date.now() - t,
    timeoutMs,
    code,
    timedOut,
  };
  results.push(row);
  await writeFile(resolve(evidence, name + ".log"), log);
  console.log(row.outcome, name, row.durationMs + " ms");
}
await writeFile(
  resolve(evidence, "summary.json"),
  JSON.stringify(results, null, 2) + "\n",
);
if (results.some((x) => x.outcome === "Fail")) process.exitCode = 1;
