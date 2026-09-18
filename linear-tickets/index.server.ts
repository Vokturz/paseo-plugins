import type { PluginServerContext } from "@getpaseo/plugin/server";
import { branchesRpc, connectRpc, issueContextRpc, disconnectRpc, listIssuesRpc, launchAgentRpc, statusRpc } from "./shared/contracts";
import { projectBranches } from "./server/projects";
import { LinearService } from "./server/linear";
import { Launcher } from "./server/launch";

export default function contribute(server: PluginServerContext) {
  const linear = new LinearService();
  const launcher = new Launcher(linear);
  server.handle(statusRpc, () => linear.status());
  server.handle(connectRpc, ({ apiKey }) => linear.authenticate(apiKey));
  server.handle(disconnectRpc, () => linear.disconnect());
  server.handle(listIssuesRpc, ({ cursor }) => linear.issues(cursor));
  server.handle(issueContextRpc, ({ id }) => linear.detail(id));
  server.handle(branchesRpc, ({ projectId }, { paseo }) => projectBranches(paseo, projectId));
  server.handle(launchAgentRpc, (input, { paseo }) => launcher.start(input, paseo));
  return () => {};
}
