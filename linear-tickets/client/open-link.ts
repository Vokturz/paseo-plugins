// React Native Web implements Linking.openURL as `window.location = url` — a same-tab
// navigation. That yanks the Paseo app away from the user and, for https://linear.app links
// that the Linear desktop app claims, leaves a dead end when Linear is not installed.
//
// So on web we open a real new tab/window instead (mirroring how the Paseo host opens
// external links). Native platforms keep the OS URL handler.
//
// Keeping this module free of a react-native import lets it stay unit-testable in Node.
export type Platform = "ios" | "android" | "web" | string | undefined;

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
// must fall back to a same-tab navigation rather than silently doing nothing.
export function openInNewTab(value: string): boolean {
  const target = typeof window === "undefined" ? null : window;
  if (!target || typeof target.open !== "function") return true;
  // "noopener,noreferrer" mirrors the host's own external-link handling.
  return !target.open(value, "_blank", "noopener,noreferrer");
}

export type LinkingLike = { openURL(url: string): Promise<unknown> };

export async function openExternalUrl(value: string, options: { platform?: Platform; linking?: LinkingLike } = {}): Promise<void> {
  if (!isSafeExternalUrl(value)) throw new Error("Only http and https links can be opened.");
  if (prefersBrowserTab(options.platform) && !openInNewTab(value)) return;
  if (!options.linking) throw new Error("No way to open links on this platform.");
  await options.linking.openURL(value);
}
