import { readFile } from "node:fs/promises";
import { reviewPromptTextSchema } from "../shared/reviewer";
import { REVIEW_PROMPT_PATH } from "./review-prompt-path.generated";

export async function readDefaultReviewPrompt(path = REVIEW_PROMPT_PATH): Promise<string> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch { throw new Error("Could not read DEFAULT_REVIEW_PROMPT.md. Check the plugin installation and rebuild or reload it."); }
  const parsed = reviewPromptTextSchema.safeParse(text);
  if (!parsed.success) throw new Error("DEFAULT_REVIEW_PROMPT.md must contain a nonempty prompt of at most 16,000 characters.");
  return parsed.data;
}
