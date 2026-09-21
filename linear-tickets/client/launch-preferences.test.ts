import assert from "node:assert/strict";
import test from "node:test";
import { restoreLaunchSelection } from "./launch-preferences";

const models = [
  { id: "codex/gpt-5", provider: "codex", thinkingOptions: [{ id: "low" }, { id: "high", isDefault: true }] },
  { id: "claude/sonnet", provider: "claude", thinkingOptions: [{ id: "normal" }], defaultThinkingOptionId: "normal" },
];
const modes = { codex: [{ id: "code" }, { id: "plan" }], claude: [] };

test("restores a provider's valid model, mode, and reasoning choices", () => {
  assert.deepEqual(
    restoreLaunchSelection("codex", { model: "codex/gpt-5", modeId: "plan", thinkingOptionId: "low" }, models, modes),
    { model: "codex/gpt-5", modeId: "plan", thinkingOptionId: "low" },
  );
});

test("drops stale choices and uses the live model's reasoning default", () => {
  assert.deepEqual(
    restoreLaunchSelection("codex", { model: "codex/gpt-5", modeId: "removed", thinkingOptionId: "removed" }, models, modes),
    { model: "codex/gpt-5", modeId: "", thinkingOptionId: "high" },
  );
  assert.deepEqual(
    restoreLaunchSelection("codex", { model: "codex/removed", modeId: "plan", thinkingOptionId: "low" }, models, modes),
    { model: "", modeId: "", thinkingOptionId: "" },
  );
});
