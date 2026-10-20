import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { filtersSchema, ownerOptionSchema } from "./filters";

export const PAGE_SIZE = 50;
export const MAX_PAGE = 20; // GitHub search exposes at most 1,000 matches.
export const POLL_INTERVAL_MS = 60_000;

export const pullRequestSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  repository: z.string(),
  url: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/),
  author: z.string().nullable(),
  updatedAt: z.string(),
  labels: z.array(z.string()),
  draft: z.boolean(),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;

export const pullRequestScopeSchema = z.enum(["review-requested", "created"]);
export type PullRequestScope = z.infer<typeof pullRequestScopeSchema>;

export const listInputSchema = z.object({
  page: z.number().int().min(1).max(MAX_PAGE).default(1),
  scope: pullRequestScopeSchema.default("review-requested"),
});
export const reviewPageSchema = z.object({
  login: z.string(),
  scope: pullRequestScopeSchema,
  filters: filtersSchema,
  pullRequests: z.array(pullRequestSchema),
  totalCount: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  nextPage: z.number().int().positive().nullable(),
  incomplete: z.boolean(),
  capped: z.boolean(),
  fetchedAt: z.string(),
});
export type ReviewPage = z.infer<typeof reviewPageSchema>;

export const listReviewsRpc = defineRpc({
  name: "github-reviews.list",
  input: listInputSchema,
  output: reviewPageSchema,
});

export const listOwnersInputSchema = z.object({ page: z.number().int().min(1).default(1) });
export const ownerPageSchema = z.object({
  login: z.string(),
  owners: z.array(ownerOptionSchema),
  nextPage: z.number().int().positive().nullable(),
});
export const listOwnersRpc = defineRpc({ name: "github-reviews.list-owners", input: listOwnersInputSchema, output: ownerPageSchema });
