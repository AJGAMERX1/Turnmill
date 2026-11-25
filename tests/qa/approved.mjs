import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// Only a reviewed value may enter this ledger. Never overwrite it during regeneration.
const ledger = JSON.parse(
  await readFile(new URL("./approved.json", import.meta.url)),
);
const dir = resolve(process.env.QA_INTEROP_OUT || "test-evidence/interop");
const { cases } = JSON.parse(await readFile(dir + "/measurements.json"));
for (const [id, entry] of Object.entries(ledger)) {
  assert.ok(
    entry.approvedBy &&
      entry.approvedOn &&
      entry.sourceSHA256?.length === 64 &&
      entry.volumeMm3 > 0,
    "Missing approval provenance for " + id,
  );
  const actual = cases.find((c) => c.case === id);
  assert.ok(actual, "Approved reference was not exercised: " + id);
  for (const key of ["native", "freecad"]) {
    const differencePercent =
      (100 * Math.abs(actual[key] - entry.volumeMm3)) / entry.volumeMm3;
    assert.ok(
      differencePercent <= 0.1,
      id +
        " " +
        key +
        " differs from approved volume by " +
        differencePercent +
        "%",
    );
  }
}
console.log(
  Object.keys(ledger).length +
    " owner-approved reference values compared. Unsigned complex candidates are excluded.",
);
