import assert from "node:assert/strict";
import {
  evaluateInteractiveBudget,
  finalHistoryEdit,
} from "./interactive-budget.mjs";
import { save } from "./runtime.mjs";
const controls = [
  {
    name: "below despite full history replay",
    input: [650, 440, 460],
    expected: "PASS",
  },
  { name: "at threshold", input: [500, 530, 490], expected: "PASS" },
];
for (const c of controls)
  assert.equal(
    evaluateInteractiveBudget(finalHistoryEdit, c.input).outcome,
    c.expected,
  );
assert.throws(
  () => evaluateInteractiveBudget("refill edit", [700, 620, 530]),
  /exceeded 500 ms/,
);
assert.throws(
  () => evaluateInteractiveBudget(finalHistoryEdit, [700, 620, 530]),
  /exceeded 500 ms/,
);
assert.throws(
  () => evaluateInteractiveBudget(finalHistoryEdit, [0, 0, 0]),
  /Invalid Apply/,
);
assert.throws(
  () => evaluateInteractiveBudget(finalHistoryEdit, [100, 200]),
  /three completed/,
);
await save("SYS-003/oracle-controls.json", {
  controls,
  unexpectedCases: [
    "slow unrelated path",
    "slow final-feature edit",
    "invalid readings",
    "incomplete readings",
  ],
  outcome: "PASS",
});
console.log(
  "PASS 500 ms browser budget controls, exact boundary, over-budget final edit, unrelated regression and malformed timings.",
);
