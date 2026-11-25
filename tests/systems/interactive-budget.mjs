import assert from "node:assert/strict";

// Limit known-failure treatment to this exact workload and its measured cause.
export const finalHistoryEdit =
  "100-feature body, edit its final additive feature";
export function evaluateInteractiveBudget(workload, durations) {
  assert.equal(
    durations.length,
    3,
    "Record three completed Apply-to-Ready samples",
  );
  for (const ms of durations)
    assert.ok(
      Number.isFinite(ms) && ms > 0,
      "Invalid Apply-to-Ready measurement",
    );
  const median = [...durations].sort((a, b) => a - b)[1];
  const result = { workload, durations, median, budgetMs: 500 };
  assert.ok(
    median <= result.budgetMs,
    workload + " exceeded 500 ms: " + median + " ms",
  );
  return { ...result, outcome: "PASS" };
}
