import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isSafeExternalUrl, openExternalUrl, prefersBrowserTab } from "./open-link";

const originalWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

function fakeLinking() {
  const opened: string[] = [];
  return { opened, linking: { openURL: async (url: string) => { opened.push(url); } } };
}

test("only http and https links are treated as safe to open", () => {
  assert.equal(isSafeExternalUrl("https://linear.app/acme/issue/ENG-1"), true);
  assert.equal(isSafeExternalUrl("http://example.com"), true);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
  assert.equal(isSafeExternalUrl("linear://issue/ENG-1"), false);
  assert.equal(isSafeExternalUrl("not a url"), false);
  assert.equal(isSafeExternalUrl(""), false);
});

test("web prefers a browser tab while native keeps the OS handler", () => {
  assert.equal(prefersBrowserTab("web"), true);
  assert.equal(prefersBrowserTab(undefined), true);
  assert.equal(prefersBrowserTab("ios"), false);
  assert.equal(prefersBrowserTab("android"), false);
});

test("rejects unsafe urls before any platform work happens", async () => {
  const { opened, linking } = fakeLinking();
  await assert.rejects(() => openExternalUrl("linear://issue/ENG-1", { platform: "web", linking }), /Only http and https links/);
  await assert.rejects(() => openExternalUrl("javascript:alert(1)", { platform: "ios", linking }), /Only http and https links/);
  assert.deepEqual(opened, []);
});

test("web opens a new tab instead of navigating the Paseo app away", async () => {
  const calls: string[] = [];
  (globalThis as { window?: unknown }).window = {
    open: (url: string, target: string, features: string) => { calls.push(`${url}|${target}|${features}`); return {}; },
  };
  const { opened, linking } = fakeLinking();
  await openExternalUrl("https://linear.app/acme/issue/ENG-1", { platform: "web", linking });
  assert.deepEqual(calls, ["https://linear.app/acme/issue/ENG-1|_blank|noopener,noreferrer"]);
  assert.deepEqual(opened, [], "must not also fall back to Linking.openURL on web");
});

test("a blocked popup falls back to the linking handler rather than doing nothing", async () => {
  (globalThis as { window?: unknown }).window = { open: () => null };
  const { opened, linking } = fakeLinking();
  await openExternalUrl("https://linear.app/acme/issue/ENG-2", { platform: "web", linking });
  assert.deepEqual(opened, ["https://linear.app/acme/issue/ENG-2"]);
});

test("native platforms go straight to the linking handler", async () => {
  const calls: string[] = [];
  (globalThis as { window?: unknown }).window = {
    open: (url: string) => { calls.push(url); return {}; },
  };
  const { opened, linking } = fakeLinking();
  await openExternalUrl("https://linear.app/acme/issue/ENG-3", { platform: "android", linking });
  assert.deepEqual(opened, ["https://linear.app/acme/issue/ENG-3"]);
  assert.deepEqual(calls, [], "native must not use window.open");
});

test("a DOM-less web runtime still opens via the linking handler", async () => {
  delete (globalThis as { window?: unknown }).window;
  const { opened, linking } = fakeLinking();
  await openExternalUrl("https://linear.app/acme/issue/ENG-4", { platform: "web", linking });
  assert.deepEqual(opened, ["https://linear.app/acme/issue/ENG-4"]);
});
