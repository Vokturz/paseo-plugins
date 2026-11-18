import type { PluginServerContext } from "@getpaseo/plugin/server";
import { branchesRpc, cachedOverviewRpc, connectRpc, countIssuesRpc, customersRpc, getSettingsRpc, issueContextRpc, disconnectRpc, getDefaultPromptRpc, listIssuesRpc, launchAgentRpc, searchIssuesRpc, setDefaultPromptRpc, setSettingsRpc, statusRpc, workspaceLabelsRpc, DEFAULT_LIST_FILTER, type ListFilter } from "./shared/contracts";
import { projectBranches } from "./server/projects";
import { LinearService, listViewKey } from "./server/linear";
import { Launcher } from "./server/launch";
import { Settings } from "./server/settings";
import { DEFAULT_PROMPT_TEMPLATE } from "./shared/contracts";
import { cacheScope, TicketCache } from "./server/cache";
import { Credentials } from "./server/credentials";

export default function contribute(server: PluginServerContext) {
  const credentials = new Credentials();
  const linear = new LinearService(credentials);
  const launcher = new Launcher(linear);
  const settings = new Settings();
  const cache = new TicketCache();
  const cacheIdentity = async () => {
    const connection = await credentials.read();
    return connection.key ? cacheScope(connection.key) : null;
  };
  server.handle(statusRpc, () => linear.status());
  server.handle(connectRpc, ({ apiKey }) => linear.authenticate(apiKey));
  server.handle(disconnectRpc, () => linear.disconnect());
  // The default list keeps the empty cache key so snapshots from older versions stay usable.
  const viewKey = (filter: ListFilter, showClosed: boolean) => {
    const key = listViewKey(filter, showClosed);
    return key === listViewKey(DEFAULT_LIST_FILTER, showClosed) ? "" : key;
  };
  server.handle(listIssuesRpc, async ({ cursor, stateNames, relation, filter = DEFAULT_LIST_FILTER }) => {
    const showClosed = (await settings.read()).showClosed;
    const page = await linear.issues(cursor, stateNames, showClosed, relation, filter);
    if (!cursor && !stateNames?.length && !relation) {
      const scope = await cacheIdentity();
      if (scope) await cache.saveIssues(scope, showClosed, page, viewKey(filter, showClosed));
    }
    return page;
  });
  server.handle(countIssuesRpc, async ({ filter = DEFAULT_LIST_FILTER }) => {
    const showClosed = (await settings.read()).showClosed;
    const counts = await linear.countIssues(showClosed, filter);
    const scope = await cacheIdentity();
    if (scope) await cache.saveCounts(scope, showClosed, counts, viewKey(filter, showClosed));
    return counts;
  });
  server.handle(cachedOverviewRpc, async ({ filter = DEFAULT_LIST_FILTER }) => {
    const scope = await cacheIdentity();
    const showClosed = (await settings.read()).showClosed;
    return scope ? cache.read(scope, showClosed, viewKey(filter, showClosed)) : null;
  });
  server.handle(workspaceLabelsRpc, ({ refresh }) => linear.workspaceLabels(refresh === true));
  server.handle(customersRpc, () => linear.customers());
  server.handle(searchIssuesRpc, ({ term, cursor }) => linear.searchIssues(term, cursor));
  server.handle(issueContextRpc, ({ id }) => linear.detail(id));
  server.handle(branchesRpc, ({ projectId }, { paseo }) => projectBranches(paseo, projectId));
  server.handle(getDefaultPromptRpc, async () => ({ template: (await settings.read()).template, builtin: DEFAULT_PROMPT_TEMPLATE }));
  server.handle(setDefaultPromptRpc, ({ template }) => settings.save(template).then((saved) => ({ ...saved, builtin: DEFAULT_PROMPT_TEMPLATE })));
  server.handle(getSettingsRpc, async () => ({ ...(await settings.read()), builtin: DEFAULT_PROMPT_TEMPLATE }));
  server.handle(setSettingsRpc, async (input) => ({ ...(await settings.patch(input)), builtin: DEFAULT_PROMPT_TEMPLATE }));
  server.handle(launchAgentRpc, async (input, { paseo }) => {
    const { template, agentLinearAccess } = await settings.read();
    return launcher.start(input, paseo, { promptTemplate: template ?? undefined, markInProgress: input.markInProgress, linearAccess: agentLinearAccess });
  });
  return () => {};
}
