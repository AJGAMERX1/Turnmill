import assert from "node:assert/strict";

// Limit known-failure treatment to this exact workload and its measured cause.
export const finalHistoryEdit =
  "100-feature body, edit its final additive feature";
export function evaluateInteractiveBudget(workload, durations, replay) {
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
  if (median <= result.budgetMs) return { ...result, outcome: "PASS" };
  const isRecordedReplay =
    workload === finalHistoryEdit &&
    replay?.coldFuses === 99 &&
    replay.unchangedFuses === 0 &&
    replay.editedFuses?.length === 3 &&
    replay.editedFuses.every((count) => count === 99);
  assert.ok(
    isRecordedReplay,
    workload +
      " exceeded 500 ms without the recorded SYS-003 full-history replay: " +
      median +
      " ms",
  );
  return {
    ...result,
    outcome: "XFAIL",
    id: "SYS-003",
    cause:
      "98 unchanged additive booleans were repeated before the changed final addition",
  };
}
