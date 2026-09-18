import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { desktopOpener, isSafeExternalUrl, openExternalUrl, prefersBrowserTab } from "./open-link";

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

test("the Electron preload bridge is detected only when paseoDesktop.opener.openUrl is a function", () => {
  assert.equal(desktopOpener(null), null);
  assert.equal(desktopOpener({}), null);
  assert.equal(desktopOpener({ paseoDesktop: {} }), null);
  assert.equal(desktopOpener({ paseoDesktop: { opener: {} } }), null);
  assert.equal(desktopOpener({ paseoDesktop: { opener: { openUrl: "nope" } } }), null);
  assert.equal(desktopOpener({ paseoDesktop: { opener: { openUrl: () => {} } } }) !== null, true);
});

test("the standard window.opener property is never mistaken for the desktop bridge", () => {
  // window.opener is the unrelated browser property holding the opening window.
  assert.equal(desktopOpener({ opener: { openUrl: () => {} } }), null);
  const calls: string[] = [];
  (globalThis as { window?: unknown }).window = {
    open: (url: string) => { calls.push(`tab:${url}`); return {}; },
    opener: { openUrl: (url: string) => { calls.push(`wrong-opener:${url}`); } },
  };
  const { opened, linking } = fakeLinking();
  return openExternalUrl("https://linear.app/acme/issue/ENG-0", { platform: "web", linking }).then(() => {
    assert.deepEqual(calls, ["tab:https://linear.app/acme/issue/ENG-0"]);
    assert.deepEqual(opened, []);
  });
});

test("the Electron app hands the url to the OS browser instead of opening an Electron window", async () => {
  const bridged: string[] = [];
  const tabbed: string[] = [];
  (globalThis as { window?: unknown }).window = {
    open: (url: string) => { tabbed.push(url); return {}; },
    paseoDesktop: { opener: { openUrl: (url: string) => { bridged.push(url); } } },
  };
  const { opened, linking } = fakeLinking();
  await openExternalUrl("https://linear.app/acme/issue/ENG-1", { platform: "web", linking });
  assert.deepEqual(bridged, ["https://linear.app/acme/issue/ENG-1"]);
  assert.deepEqual(tabbed, [], "must not open a new Electron window when the bridge exists");
  assert.deepEqual(opened, [], "must not navigate the app tab away");
});

test("a plain browser falls back to a new tab when there is no preload bridge", async () => {
  const calls: string[] = [];
  (globalThis as { window?: unknown }).window = {
    open: (url: string, target: string, features: string) => { calls.push(`${url}|${target}|${features}`); return {}; },
  };
  const { opened, linking } = fakeLinking();
  await openExternalUrl("https://linear.app/acme/issue/ENG-2", { platform: "web", linking });
  assert.deepEqual(calls, ["https://linear.app/acme/issue/ENG-2|_blank|noopener,noreferrer"]);
  assert.deepEqual(opened, [], "must not also fall back to Linking.openURL on web");
});

test("a blocked popup falls back to the linking handler rather than doing nothing", async () => {
  (globalThis as { window?: unknown }).window = { open: () => null };
  const { opened, linking } = fakeLinking();
  await openExternalUrl("https://linear.app/acme/issue/ENG-3", { platform: "web", linking });
  assert.deepEqual(opened, ["https://linear.app/acme/issue/ENG-3"]);
});

test("native platforms go straight to the linking handler", async () => {
  const calls: string[] = [];
  (globalThis as { window?: unknown }).window = {
    open: (url: string) => { calls.push(url); return {}; },
    paseoDesktop: { opener: { openUrl: (url: string) => { calls.push(`bridge:${url}`); } } },
  };
  const { opened, linking } = fakeLinking();
  await openExternalUrl("https://linear.app/acme/issue/ENG-4", { platform: "android", linking });
  assert.deepEqual(opened, ["https://linear.app/acme/issue/ENG-4"]);
  assert.deepEqual(calls, [], "native must not use window.open or the Electron bridge");
});

test("rejects unsafe urls before any platform work happens", async () => {
  const { opened, linking } = fakeLinking();
  await assert.rejects(() => openExternalUrl("linear://issue/ENG-1", { platform: "web", linking }), /Only http and https links/);
  await assert.rejects(() => openExternalUrl("javascript:alert(1)", { platform: "ios", linking }), /Only http and https links/);
  assert.deepEqual(opened, []);
});
