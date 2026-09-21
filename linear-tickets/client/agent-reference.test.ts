import assert from "node:assert/strict";
import { test } from "node:test";
import { linearAgentReference } from "./agent-reference";

test("reads the durable Linear reference from agent labels", () => {
  assert.deepEqual(linearAgentReference({
    "linear.issueId": "issue-1",
    "linear.identifier": "ENG-42",
    "linear.url": "https://linear.app/acme/issue/ENG-42/test",
  }), { issueId: "issue-1", identifier: "ENG-42", url: "https://linear.app/acme/issue/ENG-42/test" });
});

test("rejects incomplete references and non-Linear links", () => {
  assert.equal(linearAgentReference(undefined), null);
  assert.equal(linearAgentReference({ "linear.issueId": "issue-1" }), null);
  assert.equal(linearAgentReference({ "linear.issueId": "issue-1", "linear.identifier": "ENG-42", "linear.url": "https://example.com" }), null);
});
