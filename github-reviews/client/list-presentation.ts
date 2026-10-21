import type { PullRequest } from "../shared/contracts";

export function searchPage(prs: PullRequest[], query: string): PullRequest[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return prs;
  return prs.filter((pr) => {
    const text = `${pr.title} ${pr.repository} ${pr.author ? `@${pr.author}` : ""} #${pr.number}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function absoluteTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function relativeTime(value: string, now = Date.now()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.abs(now - timestamp) / 1_000;
  if (seconds < 60) return "just now";
  const [unit, size]: [string, number] = seconds < 3_600 ? ["m", 60] : seconds < 86_400 ? ["h", 3_600]
    : seconds < 604_800 ? ["d", 86_400] : seconds < 2_592_000 ? ["w", 604_800]
    : seconds < 31_536_000 ? ["mo", 2_592_000] : ["y", 31_536_000];
  const amount = Math.floor(seconds / size);
  return timestamp > now ? `in ${amount}${unit}` : `${amount}${unit} ago`;
}
