"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth-guard";
import { addCardsToDeck } from "@/lib/cards";
import { lookupWord, type LookupOutcome } from "@/lib/dictionary";
import { parseVideoId } from "@/lib/transcript";
import { saveUploadedTranscript, type UploadOutcome } from "@/lib/transcripts-db";

/**
 * The watch screen's actions. Each one checks the session first, like every
 * other action in the app: Server Actions are POST endpoints that can be hit
 * without the page ever rendering.
 */

/** The meaning of a word clicked in a transcript. */
export async function defineWord(word: string): Promise<LookupOutcome> {
  await requireSession();
  if (typeof word !== "string" || word.length > 60) return { ok: false, reason: "not-found" };
  return lookupWord(word);
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

export type AddWordOutcome = { ok: true; message: string } | { ok: false; message: string };

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
  return { ok: true, message: `Added to ${result.deck.name}.` };
}
