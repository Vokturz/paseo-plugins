import { z } from "zod";

export const LINEAR_TICKET_TIMELINE_KIND = "linear-ticket-link";
export const LINEAR_TICKET_TIMELINE_VERSION = 1;

export const linearTicketTimelineSchema = z.object({
  issueId: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string(),
  url: z.string().regex(/^https:\/\/linear\.app\//),
});
