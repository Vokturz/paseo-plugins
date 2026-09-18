import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const issueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  status: z.string(),
  priority: z.string(),
  project: z.string(),
  description: z.string(),
  team: z.string(),
  labels: z.array(z.string()),
  updatedAt: z.string(),
  createdAt: z.string().default(""),
});
export type Issue = z.infer<typeof issueSchema>;

export const detailSchema = z.object({ issue: issueSchema, context: z.string(), warnings: z.array(z.string()) });
export type TicketDetail = z.infer<typeof detailSchema>;
const connectionSchema = z.object({ connected: z.boolean(), source: z.enum(["environment", "saved", "none"]) });
export const statusRpc = defineRpc({ name: "linear.status", input: z.object({}), output: connectionSchema });
export const connectRpc = defineRpc({ name: "linear.connect", input: z.object({ apiKey: z.string().trim().min(1).max(4096) }), output: connectionSchema });
export const disconnectRpc = defineRpc({ name: "linear.disconnect", input: z.object({}), output: connectionSchema });

export const listIssuesRpc = defineRpc({
  name: "linear.list-issues",
  input: z.object({ cursor: z.string().optional() }),
  output: z.object({ issues: z.array(issueSchema), nextCursor: z.string().nullable() }),
});

export const issueContextRpc = defineRpc({
  name: "linear.issue-context",
  input: z.object({ id: z.string().min(1) }),
  output: detailSchema,
});

export const launchAgentRpc = defineRpc({
  name: "linear.launch-agent",
  input: z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    baseBranch: z.string().min(1).optional(),
    provider: z.string().regex(/^[^/]+\/.+$/),
    modeId: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
    instructions: z.string().max(10_000).default(""),
    requestId: z.string().uuid(),
  }),
  output: z.object({ agentId: z.string(), warnings: z.array(z.string()) }),
});

export const branchesRpc = defineRpc({
  name: "linear.project-branches",
  input: z.object({ projectId: z.string().min(1) }),
  output: z.object({
    branches: z.array(z.object({ id: z.string(), label: z.string() })),
    defaultBranch: z.string().nullable(),
  }),
});
