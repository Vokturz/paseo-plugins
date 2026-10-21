import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readDefaultReviewPrompt } from "./review-prompt";
import { MAX_REVIEW_PROMPT_LENGTH } from "../shared/reviewer";

test("reads the actual Markdown default and its publication authorization", async () => {
  const expected = (await readFile(new URL("../DEFAULT_REVIEW_PROMPT.md", import.meta.url), "utf8")).trim();
  assert.equal(await readDefaultReviewPrompt(), expected);
  assert.ok(expected.includes("explicitly authorizes you to write and publish a GitHub review"));
});

test("rereads edited Markdown and rejects missing, empty and oversized prompts", async () => {
  const root = await mkdtemp(join(tmpdir(), "paseo-review-prompt-"));
  const path = join(root, "DEFAULT_REVIEW_PROMPT.md");
  try {
    await assert.rejects(readDefaultReviewPrompt(path), /Could not read/);
    await writeFile(path, "First prompt\n");
    assert.equal(await readDefaultReviewPrompt(path), "First prompt");
    await writeFile(path, "Updated prompt\n");
    assert.equal(await readDefaultReviewPrompt(path), "Updated prompt");
    for (const value of [" \n ", "x".repeat(MAX_REVIEW_PROMPT_LENGTH + 1)]) {
      await writeFile(path, value);
      await assert.rejects(readDefaultReviewPrompt(path), /nonempty prompt/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
