import assert from "node:assert/strict";
import { test } from "node:test";
import type { Issue } from "../shared/contracts";
import { boardColumns } from "./board-columns";

const issue = (id: string, status: string, statusType: string): Issue => ({
  id, identifier: id, title: id, url: "", status, statusType, branchName: "", priority: "", dueDate: null, estimate: null,
  project: "", description: "", team: "", labels: [], updatedAt: "", createdAt: "", blockingCount: 0, blockedByCount: 0,
});

test("board columns follow the workflow and include counted statuses with nothing loaded", () => {
  const columns = boardColumns([
    issue("1", "In Review", "started"), issue("2", "Todo", "unstarted"), issue("3", "In Progress", "started"),
    issue("4", "Backlog", "backlog"), issue("5", "Todo", "unstarted"),
  ], { Todo: 5, "In Progress": 1, "In Review": 1, Backlog: 1, Done: 3 });
  assert.deepEqual(columns.map((column) => [column.name, column.issues.length, column.total]), [
    ["Backlog", 1, 1], ["Todo", 2, 5], ["In Progress", 1, 1], ["In Review", 1, 1], ["Done", 0, 3],
  ]);
  // Without counts (e.g. while searching) totals are the loaded tickets.
  assert.equal(boardColumns([issue("2", "Todo", "unstarted")], null)[0].total, 1);
});
