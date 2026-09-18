// Opening external links correctly is subtler than it looks in the Paseo web client.
//
// React Native Web implements Linking.openURL as `window.location = url`, a same-tab
// navigation, which would yank the Paseo app away from the user.
//
// The Electron desktop app exposes a preload bridge at `window.paseoDesktop`; its
// `opener.openUrl(url)` hands the URL to the OS default browser. Plain `window.open` inside
// Electron instead spawns a new Electron window, which is not what users expect, so the
// bridge must be preferred. This mirrors the host's own external-link handling.
//
// Keeping this module free of a react-native import lets it stay unit-testable in Node.
export type Platform = "ios" | "android" | "web" | string | undefined;

// The Electron preload script exposes this global (see the host's getElectronHost).
// Note it is `window.paseoDesktop.opener.openUrl` — not `window.opener`, which is the
// unrelated standard browser property holding the window that opened this one.
type DesktopHost = { opener?: { openUrl?: (url: string) => unknown } };

// Resolves the Electron bridge from a window-like object, defaulting to the real global.
// Returns null outside the desktop app so callers can fall back to a browser tab.
export function desktopOpener(target?: unknown): ((url: string) => unknown) | null {
  const source = target === undefined ? (typeof window === "undefined" ? undefined : window) : target;
  const host = (source as { paseoDesktop?: DesktopHost } | undefined)?.paseoDesktop;
  if (!host || typeof host !== "object") return null;
  const openUrl = host.opener?.openUrl;
  return typeof openUrl === "function" ? openUrl.bind(host.opener) : null;
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// True when this platform should use a browser tab rather than the OS URL handler.
export function prefersBrowserTab(platform?: Platform): boolean {
  return platform !== "ios" && platform !== "android";
}

// Returns true when the new tab could not be opened (popup blocker, no DOM), so the caller
// must fall back rather than silently doing nothing.
export function openInNewTab(value: string): boolean {
  const target = typeof window === "undefined" ? null : window;
  if (!target || typeof target.open !== "function") return true;
  // "noopener,noreferrer" mirrors the host's own external-link handling.
  return !target.open(value, "_blank", "noopener,noreferrer");
}

export type LinkingLike = { openURL(url: string): Promise<unknown> };

export type OpenExternalOptions = {
  platform?: Platform;
  linking?: LinkingLike;
  // Test seam: the window-like object used to find the Electron preload bridge. Pass null to
  // simulate a runtime with no bridge at all.
  desktop?: unknown;
};

export async function openExternalUrl(value: string, options: OpenExternalOptions = {}): Promise<void> {
  if (!isSafeExternalUrl(value)) throw new Error("Only http and https links can be opened.");

  if (prefersBrowserTab(options.platform)) {
    // Electron: hand off to the OS browser instead of opening a new Electron window.
    const openUrl = desktopOpener(options.desktop);
    if (openUrl) { await openUrl(value); return; }
    if (!openInNewTab(value)) return;
  }

  if (!options.linking) throw new Error("No way to open links on this platform.");
  await options.linking.openURL(value);
}
