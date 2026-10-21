export function loadRecovery(message: string): { title: string; detail: string; command?: string } {
  if (/Install GitHub CLI/i.test(message)) return {
    title: "Install GitHub CLI on your Paseo host",
    detail: "Install gh on the machine running the Paseo daemon, then sign in as the same OS user and refresh.",
    command: "gh auth login --hostname github.com",
  };
  if (/Sign in on the Paseo|valid signed-in account/i.test(message)) return {
    title: "Reconnect your GitHub account",
    detail: "Sign in on the Paseo daemon host. If GH_TOKEN or GITHUB_TOKEN is set there, check that token and its permissions, then refresh.",
    command: "gh auth login --hostname github.com",
  };
  if (/rate.limiting|rate limit/i.test(message)) return {
    title: "GitHub rate limit reached", detail: "Wait a few minutes before refreshing. Repeated retries can extend the wait.",
  };
  if (/denied access|could not search/i.test(message)) return {
    title: "Check GitHub access", detail: "Check the host account's repository access, token permissions and organization SSO authorization, then refresh.",
  };
  if (/too long|timed? out/i.test(message)) return {
    title: "GitHub took too long to respond", detail: "Check the Paseo host's connection, then try refreshing again.",
  };
  if (/invalid response|unexpected.*response|could not check commits/i.test(message)) return {
    title: "GitHub returned an unexpected response", detail: "Refresh to retry. If this keeps happening, check GitHub's service status and the GitHub CLI on your Paseo host.",
  };
  if (/saved PR filters/i.test(message)) return {
    title: "Check your saved filters", detail: "Open Filters and reset or save the settings, then refresh.",
  };
  return {
    title: "Could not load pull requests", detail: "Check the Paseo host's connection to GitHub, then refresh. If the daemon disconnected, reconnect Paseo first.",
  };
}
