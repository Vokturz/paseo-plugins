import { z } from "zod";

export const localProjectSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  path: z.string(),
});
export type LocalProject = z.infer<typeof localProjectSchema>;

export const repositoryProjectsSchema = z.object({
  status: z.enum(["available", "missing", "unknown"]),
  projects: z.array(localProjectSchema),
});
export type RepositoryProjects = z.infer<typeof repositoryProjectsSchema>;

export const projectMatchesSchema = z.object({
  projectsByRepository: z.record(z.string(), repositoryProjectsSchema).default({}),
  projectWarning: z.string().nullable().default(null),
});
export type ProjectMatches = z.infer<typeof projectMatchesSchema>;
