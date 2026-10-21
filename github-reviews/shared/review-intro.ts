import { z } from "zod";
import { reviewTargetSchema } from "./contracts";
import { shaSchema } from "./publication";

export const reviewIntroSchema = reviewTargetSchema.extend({
  title: z.string(), url: z.string(), headRef: z.string(), baseRef: z.string(),
  headSha: shaSchema, baseSha: shaSchema, reviewOnly: z.boolean(), focus: z.string().max(1_000),
}).refine((intro) => intro.url.toLowerCase() === `https://github.com/${intro.repository}/pull/${intro.number}`, "Unexpected pull request URL.");
export const reviewIntroCardSchema = z.object({ intro: reviewIntroSchema, message: z.string() });
export type ReviewIntro = z.infer<typeof reviewIntroSchema>;

export function reviewIntroMarker(intro: ReviewIntro): string {
  const json = JSON.stringify(reviewIntroSchema.parse(intro)).replace(/[<>\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `<!-- paseo-github-review-intro:v1 ${json} -->`;
}

export function parseReviewIntro(message: string): z.infer<typeof reviewIntroCardSchema> | undefined {
  if (message.length > 262_144) return;
  const markers = [...message.matchAll(/^<!-- paseo-github-review-intro:v1 ([^\r\n]*) -->$/gm)];
  for (const marker of markers.reverse()) {
    if (marker[1].length > 16_384) continue;
    try {
      const intro = reviewIntroSchema.safeParse(JSON.parse(marker[1]));
      if (intro.success) return { intro: intro.data, message };
    } catch { /* Leave unrecognized messages in Paseo's normal renderer. */ }
  }
}
