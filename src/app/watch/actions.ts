"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth-guard";
import { addCardsToDeck, removeCard } from "@/lib/cards";
import { defineInContext } from "@/lib/ai-meaning";
import type { LookupOutcome } from "@/lib/dictionary";
import { parseVideoId, type SavedCard } from "@/lib/transcript";
import { saveUploadedTranscript, type UploadOutcome } from "@/lib/transcripts-db";

/**
 * The watch screen's actions. Each one checks the session first, like every
 * other action in the app: Server Actions are POST endpoints that can be hit
 * without the page ever rendering.
 */

/**
 * The meaning of a word clicked in a transcript, as used in its line. An AI
 * model reads it in context when OPENROUTER_API_KEY is set; the dictionaries
 * answer otherwise.
 */
export async function defineWord(word: string, sentence: string): Promise<LookupOutcome> {
  await requireSession();
  if (typeof word !== "string" || word.length > 60) return { ok: false, reason: "not-found" };
  return defineInContext(word, typeof sentence === "string" ? sentence : "", {
    apiKey: process.env.OPENROUTER_API_KEY || null,
    model: process.env.OPENROUTER_MODEL,
  });
}

/** Save a pasted or uploaded transcript for a video, in place of YouTube's captions. */
export async function uploadTranscript(videoId: string, text: string): Promise<UploadOutcome> {
  await requireSession();
  const id = typeof videoId === "string" ? parseVideoId(videoId) : null;
  if (!id || typeof text !== "string") return { ok: false, message: "That transcript could not be read." };

  const outcome = await saveUploadedTranscript(id, text);
  if (outcome.ok) revalidatePath("/watch");
  return outcome;
}

export interface WordCardInput {
  deckId: string;
  front: string;
  back: string;
  example: string;
}

export type AddWordOutcome = { ok: true; message: string; card: SavedCard } | { ok: false; message: string };

/** Add a word from a video to a deck, with the line it came from as the example. */
export async function addWordToDeck(input: WordCardInput): Promise<AddWordOutcome> {
  await requireSession();
  const front = typeof input?.front === "string" ? input.front.trim() : "";
  const back = typeof input?.back === "string" ? input.back.trim() : "";
  if (front === "" || back === "") {
    return { ok: false, message: "Fill in both the word and its meaning." };
  }

  const result = await addCardsToDeck(String(input.deckId ?? ""), [
    { front, back, example: typeof input.example === "string" ? input.example : "" },
  ]);
  if (!result.ok) return { ok: false, message: "That deck no longer exists." };
  if (result.rejected.length > 0) return { ok: false, message: result.rejected[0].reason };
  if (result.added === 0) return { ok: false, message: `“${front}” is already in ${result.deck.name}.` };

  revalidatePath("/");
  revalidatePath(`/decks/${result.deck.id}`);
  const [card] = result.cards;
  return {
    ok: true,
    message: `Added to ${result.deck.name}.`,
    card: { id: card.id, deckId: result.deck.id, front: card.front, back: card.back },
  };
}

/**
 * Take a word back out of its deck, from the watch screen's sheet. Its review
 * history goes with it. A card already gone counts as removed.
 */
export async function removeWordFromDeck(cardId: string): Promise<{ message: string }> {
  await requireSession();
  const deck = await removeCard(typeof cardId === "string" ? cardId : "");
  if (!deck) return { message: "Removed." };

  revalidatePath("/");
  revalidatePath(`/decks/${deck.id}`);
  return { message: deck.name ? `Removed from ${deck.name}.` : "Removed." };
}
