"use server";

import { requireSession } from "@/lib/auth-guard";
import { cleanConversation, findWords, type FinderOutcome } from "@/lib/word-finder";
import { loadFinderCards } from "@/lib/word-finder-db";

/**
 * Answer the last question in the conversation from the cards. Checks the
 * session first, like every other action: Server Actions are POST endpoints
 * that can be hit without the page ever rendering.
 */
export async function askWordFinder(conversation: unknown): Promise<FinderOutcome> {
  await requireSession();

  const turns = cleanConversation(conversation);
  if (!turns) return { ok: false, reason: "bad-question" };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "no-key" };

  const cards = await loadFinderCards();
  return findWords(turns, cards, { apiKey, model: process.env.GEMINI_CHAT_MODEL });
}
