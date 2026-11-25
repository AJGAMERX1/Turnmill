import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { run, out } from "./support.mjs";
import { guide, pen, drawing } from "./pen.mjs";
import { ruler } from "./ruler.mjs";
import {
  hinge,
  clickPen,
  boltLibrary,
  boltScratch,
  coil,
} from "./mechanisms.mjs";
import { power, chaos } from "./personas.mjs";
const file = resolve(out, "pen/twist-pen.turnmill");
const tests = {
  guide,
  pen,
  ruler,
  hinge,
  "click-pen": clickPen,
  "click-coil": (s) => coil(s, join(out, "click-pen", "click-study.turnmill")),
  "bolt-library": boltLibrary,
  "bolt-scratch": boltScratch,
  drawing: (s) => drawing(s, existsSync(file) ? file : null),
  power,
  chaos,
};
const wanted = process.argv.slice(2);
if (wanted.some((n) => !(n in tests)))
  throw Error("Unknown project case " + wanted);
const runs = [];
for (const name of wanted.length ? wanted : Object.keys(tests)) {
  const row = await run(name, tests[name]);
  runs.push(row);
  console.log(
    row.name,
    row.status,
    row.message.split("\n").slice(0, 3).join("\n"),
  );
}
if (!wanted.length)
  await writeFile(join(out, "runs.json"), JSON.stringify(runs, null, 2));
if (runs.some((r) => r.status === "FAIL")) process.exitCode = 1;
