import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeIssue } from "../server/context";
import { filterIssues, formatIssueDate, statusCounts } from "./issue-list";

const tickets = [
  normalizeIssue({ id: "a", title: "Fix login", status: "In Progress", labels: ["mobile"], updatedAt: "2026-09-18T10:00:00Z", createdAt: "2026-01-01T00:00:00Z" }),
  normalizeIssue({ id: "b", title: "Login tests", status: "Done", updatedAt: "2026-09-17T10:00:00Z", createdAt: "2026-05-01T00:00:00Z" }),
  normalizeIssue({ id: "c", title: "New login", status: "In Progress", updatedAt: "invalid" }),
  normalizeIssue({ id: "d", title: "Custom workflow", status: "Waiting for review", updatedAt: "2026-09-18T13:00:00+04:00" }),
];

test("status and search combine, including labels and custom workflow statuses", () => {
  assert.deepEqual(filterIssues(tickets, " LOGIN ", "In Progress", "updatedAt", "newest").map((item) => item.id), ["a", "c"]);
  assert.deepEqual(filterIssues(tickets, "mobile", null, "updatedAt", "newest").map((item) => item.id), ["a"]);
  assert.deepEqual(statusCounts(tickets), [["Done", 1], ["In Progress", 2], ["Waiting for review", 1]]);
  assert.equal(filterIssues(tickets, "", "Missing status", "updatedAt", "newest").length, 0);
});

test("date sort uses actual timestamps, keeps missing dates last and does not mutate the source", () => {
  assert.deepEqual(filterIssues(tickets, "", null, "updatedAt", "newest").map((item) => item.id), ["a", "d", "b", "c"]);
  assert.deepEqual(filterIssues(tickets, "", null, "updatedAt", "oldest").map((item) => item.id), ["b", "d", "a", "c"]);
  assert.deepEqual(filterIssues(tickets, "", null, "createdAt", "newest").map((item) => item.id), ["b", "a", "c", "d"]);
  assert.deepEqual(filterIssues(tickets, "", null, "createdAt", "oldest").map((item) => item.id), ["a", "b", "c", "d"]);
  assert.deepEqual(tickets.map((item) => item.id), ["a", "b", "c", "d"]);
});

test("missing statuses and dates are visible, with created dates preserved by normalization", () => {
  assert.deepEqual(statusCounts([normalizeIssue({ id: "empty", title: "No status" })]), [["No status", 1]]);
  assert.equal(formatIssueDate("invalid"), "No date");
  assert.equal(tickets[0].createdAt, "2026-01-01T00:00:00Z");
});
