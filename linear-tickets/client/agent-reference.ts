export type LinearAgentReference = { issueId: string; identifier: string; url: string };

export function linearAgentReference(labels: Readonly<Record<string, string>> | null | undefined): LinearAgentReference | null {
  const issueId = labels?.["linear.issueId"]?.trim() ?? "";
  const identifier = labels?.["linear.identifier"]?.trim() ?? "";
  const url = labels?.["linear.url"]?.trim() ?? "";
  return issueId && identifier && /^https:\/\/linear\.app\//.test(url) ? { issueId, identifier, url } : null;
}
