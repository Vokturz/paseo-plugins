import { Interactive } from "./ui";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, ScrollView, Text, TextInput, View } from "react-native";
import { listReviewsRpc, PAGE_SIZE, POLL_INTERVAL_MS, type PullRequestScope, type ReviewFilter, type ReviewPage } from "../shared/contracts";
import { filterSettings } from "../shared/filters";
import { FiltersPanel } from "./filters";
import { reviewerSettings } from "../shared/reviewer";
import { useReviewLaunch } from "./review-action";
import { PullRequestRow } from "./pull-request-row";
import { absoluteTime, relativeTime, searchPage } from "./list-presentation";
import { prKey } from "../shared/publication";
import { ReviewOutcomesProvider } from "./review-outcomes-provider";
import { ChoicePicker } from "./choice-picker";
import { tokensFor } from "./design";
import { ReviewPageCache } from "./review-page-cache";
import { loadRecovery } from "./load-recovery";

function message(error: unknown) { return error instanceof Error ? error.message : "Could not load pull requests. Try refreshing again."; }
const reviewChoices: { id: ReviewFilter; label: string }[] = [
  { id: "all", label: "All my reviews" }, { id: "awaiting", label: "Awaiting my review" },
  { id: "reviewed", label: "Previously reviewed" }, { id: "outdated", label: "New commits since review" },
];

export function GitHubReviewsSurface({ theme, layout, navigation, onOpenReviewer }: PluginSurfaceProps & { onOpenReviewer?: () => void }) {
  const list = useRpc(listReviewsRpc);
  const latestList = useRef(list);
  latestList.current = list;
  const [cache] = useState(() => new ReviewPageCache((input) => latestList.current(input)));
  const settings = useSettings(filterSettings);
  const reviewer = useSettings(reviewerSettings);
  const launcher = useReviewLaunch();
  const configured = reviewer.status === "ready" && Boolean(reviewer.values.provider && reviewer.values.model);
  const settingsRevision = settings.status === "ready" ? settings.revision : null;
  const [scope, setScope] = useState<PullRequestScope>("review-requested");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [result, setResult] = useState<ReviewPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const currentPage = useRef(1);
  const c = theme.colors;
  const compact = layout.compact;
  const t = tokensFor(theme, layout);
  const recovery = error ? loadRecovery(error) : null;
  const visiblePRs = searchPage(result?.pullRequests ?? [], search);
  const visibleIds = new Set(visiblePRs.map((pr) => pr.id));

  const load = useCallback(async (page: number, refresh = false) => {
    if (inFlight.current || settingsRevision === null) return;
    const input = { page, scope, reviewFilter: scope === "created" ? "all" as const : reviewFilter };
    const cached = cache.read(input, settingsRevision);
    if (cached && !refresh) {
      currentPage.current = cached.page;
      setNow(Date.now());
      setResult(cached); setLoading(false); setError(null);
      return;
    }
    inFlight.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await cache.load(input, settingsRevision, refresh);
      if (generation.current !== request) return;
      currentPage.current = next.page;
      setNow(Date.now());
      setResult(next);
    } catch (error) {
      if (generation.current === request) setError(message(error));
    } finally {
      if (generation.current === request) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [cache, scope, reviewFilter, settingsRevision]);

  const resetView = (nextScope: PullRequestScope, nextFilter: ReviewFilter) => {
    generation.current++;
    inFlight.current = false;
    currentPage.current = 1;
    const cached = settingsRevision === null ? undefined : cache.read({ page: 1, scope: nextScope, reviewFilter: nextFilter }, settingsRevision);
    setResult(cached ?? null); setLoading(!cached && settingsRevision !== null);
    setError(null); setLinkError(null);
  };

  const switchScope = (next: PullRequestScope) => {
    if (next === scope) return;
    // Invalidate the previous view's response immediately, even before effect cleanup.
    resetView(next, reviewFilter);
    setScope(next);
  };

  const switchFilter = (next: ReviewFilter) => {
    if (next === reviewFilter) return;
    resetView(scope, next);
    setReviewFilter(next);
  };

  useEffect(() => {
    currentPage.current = 1;
    const cached = settingsRevision === null ? undefined : cache.read({ page: 1, scope, reviewFilter }, settingsRevision);
    setResult(cached ?? null);
    setError(null);
    setLoading(!cached && settingsRevision !== null);
    void load(1);
    return () => { generation.current++; inFlight.current = false; };
  }, [cache, load, settingsRevision]);

  // Keep the polling clock independent of view changes: switching a cached queue
  // neither restarts the timer nor triggers a fresh GitHub request.
  const currentLoad = useRef(load);
  currentLoad.current = load;
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== "background" && AppState.currentState !== "inactive") { setNow(Date.now()); void currentLoad.current(currentPage.current, true); }
    }, POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") { setNow(Date.now()); void currentLoad.current(currentPage.current, true); }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  const openPR = async (url: string) => {
    setLinkError(null);
    try { await openExternalUrl(url); }
    catch { setLinkError("Could not open the pull request in your browser. Try again."); }
  };

  const button = (title: string, onPress: () => void, disabled = false, icon?: string) => (
    <Interactive t={t} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: Math.max(40, t.touchTarget), paddingHorizontal: 13,
        borderWidth: 1, borderColor: c.border, borderRadius: 10, backgroundColor: pressed ? c.surface2 : c.surface1, opacity: disabled ? 0.45 : 1 })}>
      {icon && <Icon name={icon} size={14} color={c.foreground} />}
      <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>{title}</Text>
    </Interactive>
  );

  return <ReviewOutcomesProvider revision={result?.fetchedAt}><ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: compact ? 16 : 28, alignItems: "center" }}>
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
        {button("Refresh", () => void load(currentPage.current, true), loading, "RefreshCw")}
      </View>

      <View accessibilityRole="tablist" accessibilityLabel="Pull request lists" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {([{ scope: "review-requested", title: "My reviews", icon: "GitPullRequest" }, { scope: "created", title: "Created by me", icon: "GitBranch" }] as const).map((tab) => {
          const selected = scope === tab.scope;
          return <Interactive t={t} key={tab.scope} accessibilityRole="tab" accessibilityLabel={tab.title} accessibilityState={{ selected }} onPress={() => switchScope(tab.scope)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 7, minHeight: Math.max(40, t.touchTarget), paddingHorizontal: 13, borderRadius: 10,
              borderWidth: 1, borderColor: selected ? c.accent : c.border, backgroundColor: selected || pressed ? c.surface2 : c.surface1 })}>
            <Icon name={tab.icon} size={14} color={selected ? c.accent : c.foregroundMuted} />
            <Text style={{ color: selected ? c.accent : c.foregroundMuted, fontSize: 13, fontWeight: "600" }}>{tab.title}</Text>
          </Interactive>;
        })}
      </View>
      <FiltersPanel theme={theme} layout={layout} settings={settings} leading={scope === "review-requested" ? <View style={{ width: compact ? "100%" : 260 }}>
        <ChoicePicker label="Show reviews" placeholder="All my reviews" options={reviewChoices} value={reviewFilter} t={t} size="sm"
          onChange={(id) => { const choice = reviewChoices.find((item) => item.id === id); if (choice) switchFilter(choice.id); }} />
      </View> : undefined} />

      <View style={{ gap: 5 }}>
        <Text style={t.label}>Search this page</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 11, backgroundColor: c.surface1, ...(searchFocused ? t.focusRing : {}) }}>
          <Icon name="Search" size={15} color={c.foregroundMuted} />
          <TextInput accessibilityLabel="Search pull requests on this page" placeholder="Search this page by title, repository, author or #number"
            placeholderTextColor={c.foregroundMuted} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false}
            onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
            style={{ flex: 1, minWidth: 0, minHeight: Math.max(40, t.touchTarget), paddingVertical: 9, color: c.foreground, fontSize: 13 }} />
          {!!search && <Interactive t={t} accessibilityRole="button" accessibilityLabel="Clear page search" onPress={() => setSearch("")} style={{ alignItems: "center", justifyContent: "center" }}><Icon name="X" size={14} color={c.foregroundMuted} /></Interactive>}
        </View>
        <Text accessibilityLiveRegion="polite" style={{ color: c.foregroundMuted, fontSize: 11 }}>{search.trim() && result ? `${visiblePRs.length} of ${result.pullRequests.length} PRs on this page` : "Searches the current page only"}</Text>
      </View>

      {result && <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 6 }}>
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>@{result.login} · {result.totalCount}{result.incomplete || (result.reviewFilter === "outdated" && result.capped) ? "+" : ""} {result.totalCount === 1 ? "open PR" : "open PRs"}{result.reviewFilter === "outdated" ? " with new commits" : ""}</Text>
        <Text accessibilityLabel={`Last refreshed ${absoluteTime(result.fetchedAt)}`} style={{ color: c.foregroundMuted, fontSize: 12 }}>Updated {relativeTime(result.fetchedAt, now)}</Text>
      </View>}

      {(error || linkError) && <View accessibilityRole="alert" style={{ borderWidth: 1, borderColor: c.border, borderLeftWidth: 3, borderLeftColor: c.statusDanger, backgroundColor: c.surface1, borderRadius: 12, padding: 16, gap: 8 }}>
        <Text style={{ color: c.statusDanger, fontSize: 14, fontWeight: "600" }}>{recovery?.title ?? linkError}</Text>
        {error && <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{error}</Text>}
        {recovery && <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{recovery.detail}</Text>}
        {recovery?.command && <Text selectable style={{ color: c.foreground, fontFamily: "monospace", fontSize: 13 }}>{recovery.command}</Text>}
        {error && button("Retry loading", () => void load(currentPage.current, true), loading, "RefreshCw")}
        {error && linkError && <Text style={{ color: c.statusDanger, fontSize: 13 }}>{linkError}</Text>}
        {error && result && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Showing the last successful response. Refresh to try again.</Text>}
      </View>}

      {result?.incomplete && <Text accessibilityRole="alert" style={{ color: c.statusWarning, fontSize: 13 }}>GitHub returned partial search results. Refresh to try again.</Text>}
      {result?.capped && <Text style={{ color: c.statusWarning, fontSize: 13 }}>{result.reviewFilter === "outdated" ? "Only the first 1,000 reviewed PRs could be checked. Narrow your filters to check the rest; this count is a minimum." : "GitHub search exposes only the first 1,000 matches. The total includes additional pull requests."}</Text>}
      {result?.projectWarning && <Text accessibilityRole="alert" style={{ color: c.statusWarning, fontSize: 13 }}>{result.projectWarning}</Text>}
      {result?.headWarning && <Text accessibilityRole="alert" style={{ color: c.statusWarning, fontSize: 13 }}>{result.headWarning}</Text>}

      {result && result.pullRequests.length === 0 && <View style={{ borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1, padding: 36, alignItems: "center", gap: 12 }}>
        <Icon name={result.incomplete || result.capped ? "Search" : "CircleCheck"} size={32} color={c.accent} />
        <Text style={{ color: c.foreground, fontSize: 17, fontWeight: "600", textAlign: "center" }}>{result.incomplete || (result.reviewFilter === "outdated" && result.capped) ? "No matches in this partial response" : result.page > 1 ? "No pull requests on this page" : scope === "created" ? "No open PRs created by you" : result.reviewFilter === "outdated" ? "No new commits since your reviews" : result.reviewFilter === "awaiting" ? "No pull requests awaiting your review" : result.reviewFilter === "reviewed" ? "No previously reviewed open PRs" : "No open PRs involving your review"}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 13, textAlign: "center", lineHeight: 21 }}>{result.page > 1 ? "The list may have changed. Go back to the previous page or refresh." : result.reviewFilter === "outdated" ? "No changed heads were found among the reviews checked. Refresh or widen the saved filters to check more pull requests." : "No open pull requests match this list and your saved filters. Try widening or clearing the filters."}</Text>
      </View>}

      {result && result.pullRequests.length > 0 && visiblePRs.length === 0 && <View style={{ padding: 24, gap: 10, borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.surface1 }}>
        <Text style={{ color: c.foreground, fontSize: 15, fontWeight: "600" }}>No matches on this page</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>Try another search, clear it, or use the page controls to check another page.</Text>
        {button("Clear search", () => setSearch(""), false, "X")}
      </View>}

      {result && result.pullRequests.length > 0 && <View style={{ display: visiblePRs.length ? "flex" : "none", borderWidth: 1, borderColor: c.border, borderRadius: 14, overflow: "hidden", backgroundColor: c.surface1 }}>
        {result.pullRequests.map((pr) => <PullRequestRow key={pr.id} pr={pr} visible={visibleIds.has(pr.id)} first={visiblePRs[0]?.id === pr.id} now={now}
          match={result.projectsByRepository[pr.repository.toLowerCase()]} theme={theme} layout={layout}
          currentHead={result.headsByPr[prKey(pr.repository, pr.number)]} navigation={navigation} configured={configured}
          onOpenReviewer={onOpenReviewer} launcher={launcher} onOpenPR={() => void openPR(pr.url)} />)}
      </View>}

      {result && (result.page > 1 || result.nextPage) && <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        {button("Previous", () => void load(result.page - 1), loading || result.page === 1, "ChevronLeft")}
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Page {result.page} · {PAGE_SIZE} per page</Text>
        {button("Next", () => { if (result.nextPage) void load(result.nextPage); }, loading || !result.nextPage, "ChevronRight")}
      </View>}
      <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 19 }}>Refreshes every minute while this view is open and the app is active. Sorted by most recently updated.</Text>
    </View>
  </ScrollView></ReviewOutcomesProvider>;
}
