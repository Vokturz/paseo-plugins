/**
 * This function is serialized into `node -e` by the plugin hook. Keep it
 * self-contained: it cannot refer to imports or helpers outside its body.
 */
export function peerMcpRuntime() {
  const readline = process.getBuiltinModule("node:readline") as typeof import("node:readline");
  const childProcess = process.getBuiltinModule("node:child_process") as typeof import("node:child_process");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");

  function agentIdFromEnvironment(environment: NodeJS.ProcessEnv): string | undefined {
    const value = environment.PASEO_PEER_AGENT_ID?.trim() || environment.PASEO_AGENT_ID?.trim();
    return value && value.length <= 200 ? value : undefined;
  }

  function currentAgentId(): string | undefined {
    const inherited = agentIdFromEnvironment(process.env);
    if (inherited) return inherited;
    if (process.platform !== "linux" || process.ppid <= 1) return undefined;
    try {
      // Codex 0.9.1 does not forward the provider's environment to stdio MCP
      // children. Its parent process still has the Paseo session identity.
      const entries = fs.readFileSync(`/proc/${process.ppid}/environ`, "utf8").split("\0");
      const environment: NodeJS.ProcessEnv = {};
      for (const entry of entries) {
        if (entry.startsWith("PASEO_PEER_AGENT_ID=")) environment.PASEO_PEER_AGENT_ID = entry.slice(20);
        if (entry.startsWith("PASEO_AGENT_ID=")) environment.PASEO_AGENT_ID = entry.slice(15);
      }
      return agentIdFromEnvironment(environment);
    } catch {
      return undefined;
    }
  }

  const createSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      prompt: { type: "string", description: "Task for the new independent agent." },
      projectId: { type: "string", description: "ID of a registered Paseo project, from list_peer_projects." },
      title: { type: "string", description: "Title shown in Paseo." },
      provider: { type: "string", description: "Optional Paseo provider or provider/model; defaults to the calling agent's provider." },
      model: { type: "string", description: "Optional model; defaults to the calling agent's model when using the same provider." },
      isolation: { type: "string", enum: ["local", "worktree"], description: "Isolation for a new workspace; defaults to local." },
      branchName: { type: "string", description: "New branch name when isolation is worktree." },
      base: { type: "string", description: "Optional base ref for a worktree branch." },
    },
    required: ["prompt", "projectId"],
  };
  const sendSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      agentId: { type: "string", description: "Paseo ID of the receiving agent." },
      message: { type: "string", description: "Message to deliver to the agent's existing conversation." },
    },
    required: ["agentId", "message"],
  };
  const tools = [
    {
      name: "list_peer_projects",
      description: "List registered Paseo projects and their IDs. Use a project ID with create_peer_agent to create a new workspace in that project.",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "create_peer_agent",
      description: "Create a new workspace in a registered Paseo project and start a top-level agent there. The new agent receives your ID and can reply with send_peer_message. Returns its agent ID. Use worktree isolation for a separate checkout.",
      inputSchema: createSchema,
    },
    {
      name: "send_peer_message",
      description: "Send a message to any Paseo agent on this host by agent ID, including an independent peer in another workspace. The message includes your ID so the recipient can reply.",
      inputSchema: sendSchema,
    },
  ];

  function send(message: unknown) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  function textResult(value: unknown, isError = false) {
    return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
  }

  function requireText(value: unknown, name: string, max = 50_000): string {
    if (typeof value !== "string" || !value.trim() || value.length > max) {
      throw new Error(`${name} must be a nonempty string of at most ${max} characters`);
    }
    return value.trim();
  }

  function optionalText(value: unknown, name: string, max = 500): string | undefined {
    if (value === undefined) return undefined;
    return requireText(value, name, max);
  }

  function cli(args: string[], independent = false): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...(independent ? { PASEO_AGENT_ID: "" } : {}) };
      childProcess.execFile("paseo", [...args, "--json"], {
        env,
        timeout: 120_000,
        maxBuffer: 2_000_000,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim().slice(0, 2_000)));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Paseo returned invalid JSON: ${stdout.slice(0, 500)}`));
        }
      });
    });
  }

  async function listProjects() {
    const listed = await cli(["project", "ls"]);
    if (!Array.isArray(listed)) throw new Error("Paseo returned an invalid project list");
    return listed.map((project) => {
      if (!project || typeof project !== "object") throw new Error("Paseo returned an invalid project");
      const row = project as Record<string, unknown>;
      const projectId = requireText(row.projectId, "projectId", 200);
      const name = requireText(row.name, "project name", 500);
      const kind = requireText(row.kind, "project kind", 100);
      const projectPath = requireText(row.path, "project path", 4_096);
      if (!path.isAbsolute(projectPath)) throw new Error(`Project ${projectId} has a non-absolute path`);
      return { projectId, name, kind, path: projectPath };
    });
  }

  async function createPeer(input: Record<string, unknown>) {
    const sourceAgentId = currentAgentId();
    if (!sourceAgentId) throw new Error("This tool requires a Paseo-managed agent (PASEO_AGENT_ID is missing)");
    const prompt = requireText(input.prompt, "prompt");
    const projectId = requireText(input.projectId, "projectId", 200);
    const title = optionalText(input.title, "title");
    const providerInput = optionalText(input.provider, "provider");
    const modelInput = optionalText(input.model, "model");
    const isolation = input.isolation === undefined ? "local" : input.isolation;
    if (isolation !== "local" && isolation !== "worktree") throw new Error("isolation must be local or worktree");
    if (isolation === "local" && (input.branchName !== undefined || input.base !== undefined)) {
      throw new Error("branchName and base require worktree isolation");
    }
    const projects = await listProjects();
    const project = projects.find((candidate) => candidate.projectId === projectId);
    if (!project) throw new Error(`Unknown Paseo project ID: ${projectId}. Call list_peer_projects for available projects.`);
    if (isolation === "worktree" && project.kind !== "git") {
      throw new Error(`Project ${projectId} does not support worktree isolation`);
    }
    const slash = providerInput?.indexOf("/") ?? -1;
    const provider = slash >= 0 ? providerInput!.slice(0, slash).trim() : providerInput;
    const inlineModel = slash >= 0 ? providerInput!.slice(slash + 1).trim() : undefined;
    if (slash >= 0 && (!provider || !inlineModel)) throw new Error("provider must be a provider name or provider/model");
    if (inlineModel && modelInput && inlineModel !== modelInput) throw new Error("model conflicts with provider/model");
    const requestedModel = modelInput ?? inlineModel;
    let callerProvider: string | undefined;
    let callerModel: string | undefined;
    if (!provider || !requestedModel) {
      const caller = await cli(["agent", "inspect", sourceAgentId]) as { Provider?: unknown; Model?: unknown };
      callerProvider = requireText(caller.Provider, "calling agent provider", 200);
      callerModel = typeof caller.Model === "string" && caller.Model.trim() && caller.Model !== "-"
        ? caller.Model.trim()
        : undefined;
    }
    const selectedProvider = provider ?? callerProvider!;
    const inheritsModel = !requestedModel && selectedProvider === callerProvider;
    const selectedModel = requestedModel ?? (inheritsModel ? callerModel : undefined);
    if (inheritsModel && !selectedModel) throw new Error("Calling agent model is unavailable; specify model explicitly");

    const workspaceArgs = ["workspace", "create", "--isolation", isolation, "--project", projectId, "--path", project.path];
    if (isolation === "worktree") {
      workspaceArgs.push("--mode", "branch-off");
      const branchName = optionalText(input.branchName, "branchName");
      const base = optionalText(input.base, "base");
      if (branchName) workspaceArgs.push("--new-branch", branchName);
      if (base) workspaceArgs.push("--base", base);
    }
    const createdWorkspace = await cli(workspaceArgs) as { workspaceId?: unknown };
    const workspaceId = requireText(createdWorkspace.workspaceId, "created workspaceId", 200);

    const args = ["run", "--background", "--workspace", workspaceId];
    if (title) args.push("--title", title);
    args.push("--provider", selectedProvider);
    if (selectedModel) args.push("--model", selectedModel);
    args.push("--label", `peer.creator-agent-id=${sourceAgentId}`);
    args.push("--label", `peer.project-id=${projectId}`);
    args.push("--label", `peer.workspace-id=${workspaceId}`);
    args.push(`Your peer agent ID is ${sourceAgentId}. Use the send_peer_message tool to report progress, ask questions, and send your final result to that agent.\n\nTask:\n${prompt}`);

    // Paseo's CLI derives parentage only from PASEO_AGENT_ID. Clearing it for
    // this one launch creates a root agent directly, without a detach race.
    let created: { agentId?: unknown };
    try {
      created = await cli(args, true) as { agentId?: unknown };
    } catch (error) {
      const launchError = error instanceof Error ? error.message : String(error);
      let cleanup = `Workspace ${workspaceId} remains for inspection`;
      try {
        const possibleAgents = await cli(["agent", "ls", "-g", "--label", `peer.workspace-id=${workspaceId}`]);
        if (!Array.isArray(possibleAgents)) throw new Error("Paseo returned an invalid agent list");
        if (possibleAgents.length === 0) {
          await cli(["workspace", "archive", workspaceId]);
          cleanup = `Workspace ${workspaceId} was archived`;
        } else {
          cleanup = `Workspace ${workspaceId} was kept because an agent may have started`;
        }
      } catch (cleanupError) {
        cleanup += `; cleanup check failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
      throw new Error(`Could not start an agent in project ${project.name}: ${launchError}. ${cleanup}.`);
    }
    const agentId = requireText(created.agentId, "created agentId");
    const inspected = await cli(["agent", "inspect", agentId]) as { ParentAgentId?: unknown };
    if (inspected.ParentAgentId != null) {
      throw new Error(`Agent ${agentId} was created with a parent; inspect it in Paseo`);
    }
    return { agentId, creatorAgentId: sourceAgentId, projectId, projectName: project.name, workspaceId, provider: selectedProvider, model: selectedModel ?? null, independent: true };
  }

  async function sendPeer(input: Record<string, unknown>) {
    const sourceAgentId = currentAgentId();
    if (!sourceAgentId) throw new Error("This tool requires a Paseo-managed agent (PASEO_AGENT_ID is missing)");
    const agentId = requireText(input.agentId, "agentId", 200);
    const message = requireText(input.message, "message");
    await cli(["send", agentId, "--no-wait", `Peer agent ${sourceAgentId} says:\n\n${message}`]);
    return { deliveredTo: agentId, from: sourceAgentId };
  }

  async function handle(request: Record<string, unknown>) {
    const id = request.id;
    if (id === undefined || id === null) return;
    const method = request.method;
    if (method === "initialize") {
      const params = request.params as Record<string, unknown> | undefined;
      const protocolVersion = typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18";
      send({ jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "paseo-peer-agents", version: "0.1.0" } } });
      return;
    }
    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    if (method !== "tools/call") {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${String(method)}` } });
      return;
    }
    const params = request.params as Record<string, unknown> | undefined;
    const name = params?.name;
    const args = params?.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      send({ jsonrpc: "2.0", id, result: textResult("Tool arguments must be an object", true) });
      return;
    }
    try {
      const result = name === "list_peer_projects"
        ? await listProjects()
        : name === "create_peer_agent"
        ? await createPeer(args as Record<string, unknown>)
        : name === "send_peer_message"
          ? await sendPeer(args as Record<string, unknown>)
          : undefined;
      send({ jsonrpc: "2.0", id, result: result === undefined ? textResult(`Unknown tool: ${String(name)}`, true) : textResult(result) });
    } catch (error) {
      send({ jsonrpc: "2.0", id, result: textResult(error instanceof Error ? error.message : String(error), true) });
    }
  }

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    try {
      const request = JSON.parse(line) as Record<string, unknown>;
      if (!request || typeof request !== "object" || Array.isArray(request)) return;
      void handle(request).catch((error) => {
        if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: String(error) } });
      });
    } catch {
      // Ignore malformed notifications and keep the MCP transport alive.
    }
  });
}
