import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeIssue } from "../server/context";
import { filterIssues, formatIssueDate, formatPriority, formatRelativeDate, hasPriority, priorityTone, statusCounts, statusTone } from "./issue-list";

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

test("workflow statuses map to visual tones without hard-coding a single workflow", () => {
  assert.equal(statusTone("In Progress"), "active");
  assert.equal(statusTone("Waiting for review"), "review");
  assert.equal(statusTone("Backlog"), "backlog");
  assert.equal(statusTone("Done"), "done");
  assert.equal(statusTone("Canceled"), "canceled");
  assert.equal(statusTone("Blocked on vendor"), "neutral");
  assert.equal(statusTone(""), "neutral");
});

test("workflow categories tone states before name keywords, with a safe fallback", () => {
  assert.equal(statusTone("In Progress", "started"), "active");
  assert.equal(statusTone("In Review", "started"), "active");
  assert.equal(statusTone("Mystery", "started"), "active");
  assert.equal(statusTone("Done", "completed"), "done");
  assert.equal(statusTone("Shipped it", "completed"), "done");
  assert.equal(statusTone("Won't do", "canceled"), "canceled");
  assert.equal(statusTone("Duplicate", "duplicate"), "canceled");
  assert.equal(statusTone("Todo", "unstarted"), "backlog");
  assert.equal(statusTone("Backlog", "backlog"), "backlog");
  assert.equal(statusTone("Needs triage", "triage"), "backlog");
  // Category matching is case- and whitespace-insensitive; unknown categories fall back to the name.
  assert.equal(statusTone("In Review", "  STARTED "), "active");
  assert.equal(statusTone("Waiting for review", "weird"), "review");
  assert.equal(statusTone("Blocked on vendor", "weird"), "neutral");
});

test("priority accepts labels and Linear's numeric values", () => {
  assert.equal(formatPriority("1"), "Urgent");
  assert.equal(formatPriority("0"), "No priority");
  assert.equal(formatPriority("High"), "High");
  assert.equal(priorityTone("Urgent"), "urgent");
  assert.equal(priorityTone("2"), "high");
  assert.equal(priorityTone("Medium"), "medium");
  assert.equal(priorityTone("4"), "low");
  assert.equal(priorityTone("No priority"), "none");
  assert.equal(priorityTone(""), "none");
  assert.equal(hasPriority("Low"), true);
  assert.equal(hasPriority("No priority"), false);
});

test("relative dates stay short and fall back to a calendar date", () => {
  const now = Date.parse("2026-09-18T12:00:00Z");
  assert.equal(formatRelativeDate("2026-09-18T11:59:40Z", now), "just now");
  assert.equal(formatRelativeDate("2026-09-18T11:15:00Z", now), "45m ago");
  assert.equal(formatRelativeDate("2026-09-18T09:00:00Z", now), "3h ago");
  assert.equal(formatRelativeDate("2026-09-15T12:00:00Z", now), "3d ago");
  assert.equal(formatRelativeDate("2025-01-05T12:00:00Z", now), "Jan 5, 2025");
  assert.equal(formatRelativeDate("invalid", now), "No date");
  assert.equal(formatRelativeDate("2026-09-18T12:30:00Z", now), "30m from now");
});
