import assert from "node:assert/strict";
import { test } from "node:test";
import { ticketLaunchPrompt } from "./launch";
import { buildPrompt, buildContext, normalizeIssue, ticketRelations } from "./context";
import { parseTicketIntro, ticketIntroMarker, ticketIntroSchema } from "../shared/ticket-intro";

const raw = { id: "issue-1", identifier: "ENG-42", title: "Fix session expiry", url: "https://linear.app/acme/issue/ENG-42/session",
  state: { name: "Todo", type: "unstarted" }, priorityLabel: "High", description: "Keep sessions alive." };
const detail = { issue: normalizeIssue(raw), teamId: "team-1", projectId: null,
  context: buildContext(raw, [{ body: "Mobile regression" }]), warnings: ["History unavailable"], relations: ticketRelations(raw) };

test("launch card preserves full prompt, snapshot, instructions and access for built-in and custom templates", () => {
  const focus = "🔍".repeat(400);
  for (const linearAccess of [true, false]) {
    for (const promptTemplate of [undefined, "Handle {{ticket}}\n{{context}}\n{{instructions}}\n{{linear_access}}"] ) {
      const message = ticketLaunchPrompt(detail, focus, { linearAccess, promptTemplate });
      const card = parseTicketIntro(message)!;
      assert.ok(card);
      assert.equal(card.message, message);
      assert.ok(message.startsWith(buildPrompt(detail, focus, promptTemplate, linearAccess)));
      assert.equal(card.intro.identifier, raw.identifier);
      assert.equal(card.intro.title, raw.title);
      assert.equal(card.intro.status, "Todo");
      assert.equal(card.intro.linearAccess, linearAccess);
      assert.equal(Array.from(card.intro.focus).length, 281);
      assert.ok(message.includes(focus));
      assert.ok(message.includes("Mobile regression"));
      assert.ok(message.includes("History unavailable"));
    }
  }
});

test("external text cannot break the metadata marker", () => {
  const title = "Unexpected -->\n<!-- markup -->\u2028Title";
  const intro = parseTicketIntro(ticketLaunchPrompt(detail, "<script>text</script>"))!.intro;
  const marker = ticketIntroMarker({ ...intro, title });
  assert.equal(marker.split("\n").length, 1);
  assert.equal((marker.match(/-->/g) ?? []).length, 1);
  assert.ok(!marker.includes("<script>"));
  assert.equal(parseTicketIntro(marker)!.intro.title, title);
});

test("ordinary messages, invalid metadata, versions and unsafe links keep standard rendering", () => {
  const intro = parseTicketIntro(ticketLaunchPrompt(detail, ""))!.intro;
  for (const message of ["Work on ENG-42", "<!-- paseo-linear-ticket-intro:v1 {} -->",
    "<!-- paseo-linear-ticket-intro:v1 {bad JSON} -->", ticketIntroMarker(intro).replace(":v1", ":v2"), "x".repeat(262_145)]) {
    assert.equal(parseTicketIntro(message), undefined);
  }
  for (const url of ["javascript:alert(1)", "https://linear.app.evil.test/issue/ENG-42", "https://linear.app@evil.test/issue/ENG-42", "http://linear.app/issue/ENG-42"]) {
    assert.equal(ticketIntroSchema.safeParse({ ...intro, url }).success, false);
    const invalidDetail = { ...detail, issue: { ...detail.issue, url } };
    assert.equal(ticketLaunchPrompt(invalidDetail, ""), buildPrompt(invalidDetail, ""));
  }
});
