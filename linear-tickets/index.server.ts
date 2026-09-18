import type { PluginServerContext } from "@getpaseo/plugin/server";
import { branchesRpc, connectRpc, countIssuesRpc, issueContextRpc, disconnectRpc, getDefaultPromptRpc, listIssuesRpc, launchAgentRpc, searchIssuesRpc, setDefaultPromptRpc, statusRpc } from "./shared/contracts";
import { projectBranches } from "./server/projects";
import { LinearService } from "./server/linear";
import { Launcher } from "./server/launch";
import { Settings } from "./server/settings";
import { DEFAULT_PROMPT_TEMPLATE } from "./shared/contracts";

export default function contribute(server: PluginServerContext) {
  const linear = new LinearService();
  const launcher = new Launcher(linear);
  const settings = new Settings();
  server.handle(statusRpc, () => linear.status());
  server.handle(connectRpc, ({ apiKey }) => linear.authenticate(apiKey));
  server.handle(disconnectRpc, () => linear.disconnect());
  server.handle(listIssuesRpc, ({ cursor, stateNames, activeOnly }) => linear.issues(cursor, stateNames, activeOnly));
  server.handle(countIssuesRpc, () => linear.countIssues());
  server.handle(searchIssuesRpc, ({ term, cursor }) => linear.searchIssues(term, cursor));
  server.handle(issueContextRpc, ({ id }) => linear.detail(id));
  server.handle(branchesRpc, ({ projectId }, { paseo }) => projectBranches(paseo, projectId));
  server.handle(getDefaultPromptRpc, async () => ({ template: (await settings.read()).template, builtin: DEFAULT_PROMPT_TEMPLATE }));
  server.handle(setDefaultPromptRpc, ({ template }) => settings.save(template).then((saved) => ({ ...saved, builtin: DEFAULT_PROMPT_TEMPLATE })));
  server.handle(launchAgentRpc, async (input, { paseo }) => {
    const { template } = await settings.read();
    return launcher.start(input, paseo, { promptTemplate: template ?? undefined });
  });
  return () => {};
}
