import assert from "node:assert/strict";
import {
  evaluateInteractiveBudget,
  finalHistoryEdit,
} from "./interactive-budget.mjs";
import { save } from "./runtime.mjs";
const repeated = {
  coldFuses: 99,
  unchangedFuses: 0,
  editedFuses: [99, 99, 99],
};
const controls = [
  {
    name: "below despite full history replay",
    input: [650, 440, 460],
    expected: "PASS",
  },
  { name: "at threshold", input: [500, 530, 490], expected: "PASS" },
  {
    name: "over with measured known cause",
    input: [430, 505, 520],
    expected: "XFAIL",
  },
];
for (const c of controls)
  assert.equal(
    evaluateInteractiveBudget(finalHistoryEdit, c.input, repeated).outcome,
    c.expected,
  );
assert.throws(
  () => evaluateInteractiveBudget("refill edit", [700, 620, 530], repeated),
  /exceeded 500 ms/,
);
assert.throws(
  () =>
    evaluateInteractiveBudget(finalHistoryEdit, [700, 620, 530], {
      ...repeated,
      editedFuses: [1, 1, 1],
    }),
  /exceeded 500 ms/,
);
assert.throws(
  () => evaluateInteractiveBudget(finalHistoryEdit, [0, 0, 0], repeated),
  /Invalid Apply/,
);
assert.throws(
  () => evaluateInteractiveBudget(finalHistoryEdit, [100, 200], repeated),
  /three completed/,
);
await save("SYS-003/oracle-controls.json", {
  controls,
  unexpectedCases: [
    "slow unrelated path",
    "slow without full replay",
    "invalid readings",
    "incomplete readings",
  ],
  outcome: "PASS",
});
console.log(
  "PASS 500 ms browser budget controls, exact boundary, scoped known failure, unrelated regression and malformed timings.",
);
