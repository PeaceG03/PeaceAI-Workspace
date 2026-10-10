import assert from "node:assert/strict";
import test from "node:test";

import { countByStatus, isFinished, type Task } from "./status";

const tasks: Task[] = [
  { id: "1", title: "a", status: "open" },
  { id: "2", title: "b", status: "done" },
  { id: "3", title: "c", status: "failed" },
];

test("isFinished is true only for done and failed", () => {
  assert.equal(isFinished(tasks[0]!), false);
  assert.equal(isFinished(tasks[1]!), true);
  assert.equal(isFinished(tasks[2]!), true);
});

test("countByStatus counts matching tasks", () => {
  assert.equal(countByStatus(tasks, "done"), 1);
  assert.equal(countByStatus(tasks, "running"), 0);
});
