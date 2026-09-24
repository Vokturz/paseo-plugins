// Minimal, dependency-free Markdown block parser for ticket descriptions.
// Linear descriptions commonly use headings, lists, checkboxes, quotes and code fences,
// and rendering them as flat paragraphs made tickets hard to scan.

export type TableAlign = "left" | "center" | "right";

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "divider" }
  | { type: "code"; language: string; code: string }
  | { type: "list"; ordered: boolean; items: { text: string; checked?: boolean }[] }
  | { type: "table"; header: string[]; align: TableAlign[]; rows: string[][] };

const FENCE = /```([^\n`]*)\n?([\s\S]*?)```/g;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*\S)\s*$/;
const DIVIDER = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const HEADING_LEVELS = 6;

/** Splits a table row on unescaped pipes, tolerating optional outer pipes and ragged rows. */
function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char === "\\" && body[index + 1] === "|") { current += "|"; index++; continue; }
    if (char === "|") { cells.push(current.trim()); current = ""; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

// The delimiter row (| --- | :--: |) is what makes a pipe line a table instead of prose.
function isDelimiterRow(line: string) {
  if (!line.includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function alignments(delimiter: string[]): TableAlign[] {
  return delimiter.map((cell) => {
    const left = cell.startsWith(":"), right = cell.endsWith(":");
    return left && right ? "center" : left ? "left" : right ? "right" : "left";
  });
}

function parseLines(lines: string[], blocks: MarkdownBlock[]) {
  let paragraph: string[] = [];
  let list: Extract<MarkdownBlock, { type: "list" }> | null = null;
  let quote: string[] = [];

  const flushParagraph = () => { if (paragraph.length) { blocks.push({ type: "paragraph", text: paragraph.join("\n") }); paragraph = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  const flushQuote = () => { if (quote.length) { blocks.push({ type: "quote", text: quote.join("\n") }); quote = []; } };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { flush(); continue; }

    const heading = HEADING.exec(line);
    if (heading) { flush(); blocks.push({ type: "heading", level: Math.min(heading[1].length, HEADING_LEVELS), text: heading[2] }); continue; }

    if (DIVIDER.test(line)) { flush(); blocks.push({ type: "divider" }); continue; }

    if (line.includes("|") && index + 1 < lines.length && isDelimiterRow(lines[index + 1])) {
      flush();
      const header = splitRow(line);
      const align = alignments(splitRow(lines[index + 1]));
      const rows: string[][] = [];
      let cursor = index + 2;
      while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes("|")) { rows.push(splitRow(lines[cursor])); cursor++; }
      blocks.push({ type: "table", header, align, rows });
      index = cursor - 1;
      continue;
    }

    const quoteLine = QUOTE.exec(line);
    if (quoteLine) { flushParagraph(); flushList(); quote.push(quoteLine[1]); continue; }

    const task = TASK.exec(line);
    if (task) {
      flushParagraph(); flushQuote();
      if (!list || list.ordered) { flushList(); list = { type: "list", ordered: false, items: [] }; }
      list.items.push({ text: task[2], checked: task[1].toLowerCase() === "x" });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      flushParagraph(); flushQuote();
      const ordered = Boolean(item[3]);
      // A different marker style starts a new list; nested items keep the current one.
      if (!list || list.ordered !== ordered) { flushList(); list = { type: "list", ordered, items: [] }; }
      list.items.push({ text: item[4] });
      continue;
    }

    flushList(); flushQuote();
    paragraph.push(line);
  }
  flush();
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let cursor = 0;
  for (const match of markdown.matchAll(FENCE)) {
    const start = match.index ?? 0;
    if (start > cursor) parseLines(markdown.slice(cursor, start).split("\n"), blocks);
    blocks.push({ type: "code", language: (match[1] ?? "").trim(), code: match[2].replace(/\n$/, "") });
    cursor = start + match[0].length;
  }
  if (cursor < markdown.length) parseLines(markdown.slice(cursor).split("\n"), blocks);
  return blocks;
}