import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from "react-native";
import { listReviewsRpc, PAGE_SIZE, POLL_INTERVAL_MS, type PullRequestScope, type ReviewPage } from "../shared/contracts";
import { filterSettings } from "../shared/filters";
import { FiltersPanel } from "./filters";
import { ProjectAvailability } from "./project-availability";
import { reviewerSettings } from "../shared/reviewer";
import { ReviewAction, useReviewLaunch } from "./review-action";
import { prKey } from "../shared/publication";

function message(error: unknown) { return error instanceof Error ? error.message : "Could not load pull requests. Try refreshing again."; }
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function GitHubReviewsSurface({ theme, layout, navigation, onOpenReviewer }: PluginSurfaceProps & { onOpenReviewer?: () => void }) {
  const list = useRpc(listReviewsRpc);
  const settings = useSettings(filterSettings);
  const reviewer = useSettings(reviewerSettings);
  const launcher = useReviewLaunch();
  const configured = reviewer.status === "ready" && Boolean(reviewer.values.provider && reviewer.values.model);
  const settingsRevision = settings.status === "ready" ? settings.revision : null;
  const [scope, setScope] = useState<PullRequestScope>("review-requested");
  const [result, setResult] = useState<ReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const currentPage = useRef(1);
  const c = theme.colors;
  const compact = layout.compact;

  const load = useCallback(async (page: number) => {
    if (inFlight.current || settingsRevision === null) return;
    inFlight.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await list({ page, scope });
      if (generation.current !== request) return;
      currentPage.current = next.page;
      setResult(next);
    } catch (error) {
      if (generation.current === request) setError(message(error));
    } finally {
      if (generation.current === request) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [list, scope, settingsRevision]);

  const switchScope = (next: PullRequestScope) => {
    if (next === scope) return;
    // Invalidate the previous view's response immediately, even before effect cleanup.
    generation.current++;
    inFlight.current = false;
    currentPage.current = 1;
    setResult(null);
    setLoading(true);
    setError(null);
    setLinkError(null);
    setScope(next);
  };

  useEffect(() => {
    currentPage.current = 1;
    setResult(null);
    setError(null);
    setLoading(settingsRevision !== null);
    void load(1);
    const timer = setInterval(() => {
      if (AppState.currentState !== "background" && AppState.currentState !== "inactive") void load(currentPage.current);
    }, POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load(currentPage.current);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      generation.current++;
      inFlight.current = false;
    };
  }, [load, settingsRevision]);

  const openPR = async (url: string) => {
    setLinkError(null);
    try { await openExternalUrl(url); }
    catch { setLinkError("Could not open the pull request in your browser. Try again."); }
  };

  const button = (title: string, onPress: () => void, disabled = false, icon?: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 40, paddingHorizontal: 13,
        borderWidth: 1, borderColor: c.border, borderRadius: 10, backgroundColor: pressed ? c.surface2 : c.surface1, opacity: disabled ? 0.45 : 1 })}>
      {icon && <Icon name={icon} size={14} color={c.foreground} />}
      <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );

  return <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: compact ? 16 : 28, alignItems: "center" }}>
    <View style={{ width: "100%", maxWidth: 1050, gap: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
          <Icon name="GitPullRequest" size={23} color={c.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
          <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: compact ? 23 : 28, fontWeight: "700" }}>GitHub reviews</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{scope === "created" ? "Open pull requests you created" : "Open pull requests requested for review or already reviewed by you"}</Text>
        </View>
        {loading && <ActivityIndicator accessibilityLabel="Loading pull requests" size="small" color={c.accent} />}
        {onOpenReviewer && button("Reviewer setup", onOpenReviewer, false, "Bot")}
        {button("Refresh", () => void load(currentPage.current), loading, "RefreshCw")}
      </View>

      <FiltersPanel theme={theme} settings={settings} />

      <View accessibilityRole="tablist" accessibilityLabel="Pull request lists" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {([{ scope: "review-requested", title: "My reviews", icon: "GitPullRequest" }, { scope: "created", title: "Created by me", icon: "GitBranch" }] as const).map((tab) => {
          const selected = scope === tab.scope;
          return <Pressable key={tab.scope} accessibilityRole="tab" accessibilityLabel={tab.title} accessibilityState={{ selected }} onPress={() => switchScope(tab.scope)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 7, minHeight: 40, paddingHorizontal: 13, borderRadius: 10,
              borderWidth: 1, borderColor: selected ? c.accent : c.border, backgroundColor: selected || pressed ? c.surface2 : c.surface1 })}>
            <Icon name={tab.icon} size={14} color={selected ? c.accent : c.foregroundMuted} />
            <Text style={{ color: selected ? c.accent : c.foregroundMuted, fontSize: 13, fontWeight: "600" }}>{tab.title}</Text>
          </Pressable>;
        })}
      </View>

      {result && <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 6 }}>
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>@{result.login} · {result.totalCount}{result.incomplete ? "+" : ""} {result.totalCount === 1 ? "open PR" : "open PRs"}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Updated {date(result.fetchedAt)}</Text>
      </View>}

      {(error || linkError) && <View accessibilityRole="alert" style={{ borderWidth: 1, borderColor: c.border, borderLeftWidth: 3, borderLeftColor: c.statusDanger, backgroundColor: c.surface1, borderRadius: 12, padding: 16, gap: 8 }}>
        <Text style={{ color: c.statusDanger, fontSize: 14, fontWeight: "600" }}>{error || linkError}</Text>
        {error && result && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Showing the last successful response. Refresh to try again.</Text>}
      </View>}

      {!result && !loading && settingsRevision !== null && <View style={{ borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1, padding: 24, gap: 14 }}>
        <Text style={{ color: c.foreground, fontSize: 17, fontWeight: "600" }}>Connect GitHub on your Paseo host</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 14, lineHeight: 22 }}>Install GitHub CLI on the machine running the Paseo daemon and sign in as the same OS user. Then return here and refresh.</Text>
        <Text selectable style={{ color: c.foreground, fontFamily: "monospace", fontSize: 13, padding: 14, borderRadius: 10, backgroundColor: c.surface0 }}>gh auth login --hostname github.com</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 19 }}>Uses the host's GitHub account, including GH_TOKEN or GITHUB_TOKEN when set. All clients connected to this daemon share that account.</Text>
      </View>}

      {result?.incomplete && <Text accessibilityRole="alert" style={{ color: c.statusWarning, fontSize: 13 }}>GitHub returned partial search results. Refresh to try again.</Text>}
      {result?.capped && <Text style={{ color: c.statusWarning, fontSize: 13 }}>GitHub search exposes only the first 1,000 matches. The total includes additional pull requests.</Text>}
      {result?.projectWarning && <Text accessibilityRole="alert" style={{ color: c.statusWarning, fontSize: 13 }}>{result.projectWarning}</Text>}
      {result?.headWarning && <Text accessibilityRole="alert" style={{ color: c.statusWarning, fontSize: 13 }}>{result.headWarning}</Text>}

      {result && result.pullRequests.length === 0 && <View style={{ borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1, padding: 36, alignItems: "center", gap: 12 }}>
        <Icon name={result.incomplete ? "Search" : "CircleCheck"} size={32} color={c.accent} />
        <Text style={{ color: c.foreground, fontSize: 17, fontWeight: "600", textAlign: "center" }}>{result.incomplete ? "No matches in this partial response" : result.page > 1 ? "No pull requests on this page" : scope === "created" ? "No open PRs created by you" : "No open PRs involving your review"}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 13, textAlign: "center", lineHeight: 21 }}>{result.page > 1 ? "The list may have changed. Go back to the previous page or refresh." : "No open pull requests match this list and your saved filters. Try widening or clearing the filters."}</Text>
      </View>}

      {result && result.pullRequests.length > 0 && <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 16, overflow: "hidden", backgroundColor: c.surface1 }}>
        {result.pullRequests.map((pr, index) => <View key={pr.id}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: compact ? 10 : 15, padding: compact ? 16 : 20,
            borderTopWidth: index ? 1 : 0, borderTopColor: c.border }}>
          <View style={{ paddingTop: 3 }}><Icon name="GitPullRequest" size={18} color={pr.draft ? c.foregroundMuted : c.statusSuccess} /></View>
          <View style={{ flex: 1, gap: 7 }}>
            <Pressable accessibilityRole="link" accessibilityLabel={`Open ${pr.repository} #${pr.number}: ${pr.title}`} onPress={() => void openPR(pr.url)} style={{ gap: 7 }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{pr.repository} <Text style={{ fontWeight: "600" }}>#{pr.number}</Text>{pr.draft ? " · Draft" : ""}</Text>
              <Text style={{ color: c.foreground, fontSize: 15, lineHeight: 22, fontWeight: "600" }}>{pr.title}</Text>
            </Pressable>
            <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{pr.author ? `@${pr.author}` : "Deleted account"} · Updated {date(pr.updatedAt)}</Text>
            <ProjectAvailability theme={theme} match={result.projectsByRepository[pr.repository.toLowerCase()]} />
            {pr.labels.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {pr.labels.slice(0, 3).map((label) => <Text key={label} numberOfLines={1} style={{ maxWidth: 200, color: c.foregroundMuted, fontSize: 11, backgroundColor: c.surface2, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>{label}</Text>)}
              {pr.labels.length > 3 && <Text style={{ color: c.foregroundMuted, fontSize: 11, paddingVertical: 3 }}>+{pr.labels.length - 3}</Text>}
            </View>}
            <ReviewAction pr={pr} match={result.projectsByRepository[pr.repository.toLowerCase()]} theme={theme} layout={layout}
              currentHead={result.headsByPr[prKey(pr.repository, pr.number)]}
              navigation={navigation} configured={configured} onOpenReviewer={onOpenReviewer} launcher={launcher} />
          </View>
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${pr.repository} #${pr.number} on GitHub`} onPress={() => void openPR(pr.url)} style={{ padding: 5 }}>
            <Icon name="ExternalLink" size={15} color={c.foregroundMuted} />
          </Pressable>
        </View>)}
      </View>}

      {result && (result.page > 1 || result.nextPage) && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        {button("Previous", () => void load(result.page - 1), loading || result.page === 1, "ChevronLeft")}
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Page {result.page} · {PAGE_SIZE} per page</Text>
        {button("Next", () => { if (result.nextPage) void load(result.nextPage); }, loading || !result.nextPage, "ChevronRight")}
      </View>}
      <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 19 }}>Refreshes every minute while this view is open and the app is active. Sorted by most recently updated.</Text>
    </View>
  </ScrollView>;
}
