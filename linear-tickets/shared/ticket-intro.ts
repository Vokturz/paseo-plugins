import { z } from "zod";

export const ticketIntroSchema = z.object({
  identifier: z.string().min(1), title: z.string(),
  url: z.string().refine((value) => {
    try { const url = new URL(value); return url.origin === "https://linear.app" && !url.username && !url.password; }
    catch { return false; }
  }, "Unexpected Linear URL."),
  status: z.string(), statusType: z.string(), priority: z.string(),
  project: z.string(), team: z.string(), linearAccess: z.boolean(), focus: z.string(),
});
export const ticketIntroCardSchema = z.object({ intro: ticketIntroSchema, message: z.string() });
export type TicketIntro = z.infer<typeof ticketIntroSchema>;

export function ticketIntroMarker(intro: TicketIntro): string {
  const json = JSON.stringify(ticketIntroSchema.parse(intro)).replace(/[<>\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `<!-- paseo-linear-ticket-intro:v1 ${json} -->`;
}

export function parseTicketIntro(message: string): z.infer<typeof ticketIntroCardSchema> | undefined {
  if (message.length > 262_144) return;
  const markers = [...message.matchAll(/^<!-- paseo-linear-ticket-intro:v1 ([^\r\n]*) -->$/gm)];
  for (const marker of markers.reverse()) {
    if (marker[1].length > 65_536) continue;
    try {
      const intro = ticketIntroSchema.safeParse(JSON.parse(marker[1]));
      if (intro.success) return { intro: intro.data, message };
    } catch { /* Unrecognized messages keep Paseo's standard renderer. */ }
  }
}
