import { z } from "zod";

export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/i);
export const reviewerIdentitySchema = z.object({ id: z.number().int().positive(), login: z.string().regex(/^[A-Za-z0-9_-]+$/) });
const prose = (max: number) => z.string().trim().max(max).refine((text) => !/<!--\s*paseo-/i.test(text), "Reserved publication markers are not allowed.");
export const reviewFindingSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._:/-]{0,199}$/),
  priority: z.enum(["P1", "P2"]), title: prose(160).refine((value) => value.length > 0),
  body: prose(8_000).refine((value) => value.length > 0),
  path: z.string().min(1).max(500).refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes("..") && !/[\x00-\x1f]/.test(value)),
  side: z.enum(["LEFT", "RIGHT"]).default("RIGHT"),
  line: z.number().int().positive(), startLine: z.number().int().positive().optional(),
}).strict().refine((value) => value.startLine === undefined || (value.startLine <= value.line && value.line - value.startLine < 20), "Use a small, ordered diff range.");
export const reviewSubmissionSchema = z.object({
  complete: z.literal(true),
  conclusion: z.enum(["clean", "issues", "follow-up"]),
  body: prose(20_000).default(""),
  findings: z.array(reviewFindingSchema).max(50).default([]),
  fixedCommentIds: z.array(z.number().int().positive()).max(100).default([]),
}).strict().superRefine((value, context) => {
  if (new Set(value.findings.map((finding) => finding.key)).size !== value.findings.length) context.addIssue({ code: "custom", message: "Finding keys must be unique." });
  if (value.conclusion === "clean" && value.findings.length) context.addIssue({ code: "custom", message: "A clean review cannot contain findings." });
  if (value.conclusion === "issues" && !value.findings.length) context.addIssue({ code: "custom", message: "Include the confirmed findings." });
});
export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export const reviewOutcomeSchema = z.object({
  id: z.uuid(), agentId: z.string(), repository: z.string(), number: z.number().int().positive(),
  headSha: shaSchema, baseSha: shaSchema,
  status: z.enum(["reviewing", "publishing", "published", "blocked", "skipped"]),
  reason: z.string().nullable(), reviewUrl: z.string().nullable(), updatedAt: z.string(),
});
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;
export function prKey(repository: string, number: number) { return `${repository.toLowerCase()}#${number}`; }
