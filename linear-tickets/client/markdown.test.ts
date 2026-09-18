import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkdown } from "./markdown";

test("headings, lists, checkboxes, quotes and dividers become distinct blocks", () => {
  const blocks = parseMarkdown([
    "# Summary",
    "",
    "A short intro that",
    "wraps onto two lines.",
    "",
    "- first",
    "- second",
    "",
    "1. one",
    "2. two",
    "",
    "- [x] shipped",
    "- [ ] pending",
    "",
    "> a quoted note",
    "",
    "---",
  ].join("\n"));
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "list", "list", "list", "quote", "divider"]);
  assert.deepEqual(blocks[0], { type: "heading", level: 1, text: "Summary" });
  assert.deepEqual(blocks[1], { type: "paragraph", text: "A short intro that\nwraps onto two lines." });
  assert.deepEqual(blocks[2], { type: "list", ordered: false, items: [{ text: "first" }, { text: "second" }] });
  assert.deepEqual(blocks[3], { type: "list", ordered: true, items: [{ text: "one" }, { text: "two" }] });
  assert.deepEqual(blocks[4], { type: "list", ordered: false, items: [{ text: "shipped", checked: true }, { text: "pending", checked: false }] });
  assert.deepEqual(blocks[5], { type: "quote", text: "a quoted note" });
});

test("fenced code keeps its language and body, including blank lines and markdown-looking text", () => {
  const blocks = parseMarkdown("Before\n\n```ts\nconst a = 1;\n\n# not a heading\n```\n\nAfter");
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "code", "paragraph"]);
  assert.deepEqual(blocks[1], { type: "code", language: "ts", code: "const a = 1;\n\n# not a heading" });
});

test("an unclosed fence stays visible instead of swallowing the rest of the ticket", () => {
  assert.deepEqual(parseMarkdown("```\nno closing fence"), [{ type: "paragraph", text: "```\nno closing fence" }]);
});

test("plain text without markdown is a single paragraph", () => {
  assert.deepEqual(parseMarkdown("Just a sentence."), [{ type: "paragraph", text: "Just a sentence." }]);
});

test("pipe tables become table blocks with per-column alignment", () => {
  const blocks = parseMarkdown([
    "| Kind | Produces | Notes |",
    "| :--- | :---: | ---: |",
    "| XML | plan | structured |",
    "| PDF | sections | raw text only |",
  ].join("\n"));
  assert.deepEqual(blocks, [{
    type: "table",
    header: ["Kind", "Produces", "Notes"],
    align: ["left", "center", "right"],
    rows: [["XML", "plan", "structured"], ["PDF", "sections", "raw text only"]],
  }]);
});

test("tables tolerate missing outer pipes, ragged cells and escaped pipes", () => {
  const blocks = parseMarkdown([
    "| what it produces |",
    "| --- | --- |",
    "| a \\| b | second |",
    "| only-one |",
  ].join("\n"));
  assert.deepEqual(blocks, [{
    type: "table",
    header: ["what it produces"],
    align: ["left", "left"],
    rows: [["a | b", "second"], ["only-one"]],
  }]);
});

test("a table ends at a blank line or a line without pipes", () => {
  const blocks = parseMarkdown(["| a |", "| --- |", "| 1 |", "", "After the table"].join("\n"));
  assert.deepEqual(blocks.map((block) => block.type), ["table", "paragraph"]);
  assert.deepEqual(blocks[1], { type: "paragraph", text: "After the table" });
});

test("a pipe in prose without a delimiter row stays a paragraph", () => {
  assert.deepEqual(parseMarkdown("Use `a | b` inline."), [{ type: "paragraph", text: "Use `a | b` inline." }]);
});
