import assert from "node:assert/strict";
import { test } from "node:test";
import { commandError } from "./github";
import { loadRecovery } from "../client/load-recovery";

test("only missing CLI and authentication failures recommend signing in", () => {
  for (const failure of [{ code: "ENOENT" }, { stderr: "HTTP 401" }]) assert.equal(loadRecovery(commandError(failure).message).command, "gh auth login --hostname github.com");
  for (const failure of [{ stderr: "HTTP 429" }, { stderr: "HTTP 403" }, { stderr: "HTTP 422" }, { killed: true }, { stderr: "HTTP 502" }]) {
    assert.equal(loadRecovery(commandError(failure).message).command, undefined);
  }
  assert.match(loadRecovery(commandError({ stderr: "HTTP 429" }).message).detail, /Wait/);
  assert.match(loadRecovery(commandError({ stderr: "HTTP 403" }).message).detail, /SSO/);
  assert.match(loadRecovery(commandError({ killed: true }).message).title, /too long/);
  assert.match(loadRecovery("GitHub returned an unexpected pull request response.").title, /unexpected/);
  assert.match(loadRecovery("The saved PR filters are invalid.").detail, /Filters/);
  assert.equal(loadRecovery("RPC disconnected").command, undefined);
});
