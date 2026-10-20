import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const ownerSchema = z.string().trim().transform((value) => value.replace(/^@/, "").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,38}$/, "Enter GitHub organization or user names, without URLs or repository names."));

export const filtersSchema = z.object({
  owners: z.array(ownerSchema).max(10, "Choose at most 10 organizations or users.").default([])
    .transform((values) => [...new Set(values)])
    .refine((values) => values.join("").length <= 160, "Use a shorter owner list (at most 160 characters in total)."),
  days: z.number().int().min(1).max(3650).nullable().default(null),
  dateField: z.enum(["updated", "created"]).default("updated"),
});
export type Filters = z.infer<typeof filtersSchema>;

export const filterSettings = defineSettings({ id: "filters", scope: "host", version: 1, schema: filtersSchema });

export const ownerOptionSchema = z.object({ login: ownerSchema, kind: z.enum(["user", "organization"]) });
export type OwnerOption = z.infer<typeof ownerOptionSchema>;

export function ownerChoices(available: OwnerOption[], selected: string[]): { login: string; kind?: OwnerOption["kind"] }[] {
  const choices = new Map<string, { login: string; kind?: OwnerOption["kind"] }>();
  // Keep saved selections visible even if their repositories are not on the loaded pages.
  for (const login of selected) choices.set(login.toLowerCase(), { login: login.toLowerCase() });
  for (const owner of available) choices.set(owner.login.toLowerCase(), { ...owner, login: owner.login.toLowerCase() });
  return [...choices.values()].sort((a, b) => a.login.localeCompare(b.login));
}

export function timeWindowOptions(savedDays: number | null): { days: number | null; label: string }[] {
  const options: { days: number | null; label: string }[] = [
    { days: null, label: "Any time" }, { days: 1, label: "Last 24 hours" },
    { days: 7, label: "Last 7 days" }, { days: 14, label: "Last 14 days" },
    { days: 30, label: "Last 30 days" }, { days: 90, label: "Last 90 days" },
    { days: 180, label: "Last 6 months" }, { days: 365, label: "Last year" },
  ];
  if (savedDays !== null && !options.some((option) => option.days === savedDays)) options.push({ days: savedDays, label: `Last ${savedDays} days` });
  return options;
}

export function filterSummary(filters: Filters): string {
  const owners = filters.owners.length ? filters.owners.join(", ") : "All organizations and users";
  return `${owners} · ${filters.days === null ? "Any time" : `${filters.dateField === "created" ? "Created" : "Updated"} in the last ${filters.days} ${filters.days === 1 ? "day" : "days"}`}`;
}
