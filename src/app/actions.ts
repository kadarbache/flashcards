"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, ReviewLog } from "@/lib/db/models";
import { getNextCard, type NextCardResult, type QueueOptions } from "@/lib/decks";
import { addCardsToDeck } from "@/lib/cards";
import { parseCards, SEPARATORS, type SeparatorName } from "@/lib/import";
import { answerCard, undoLastAnswer } from "@/lib/review";
import type { Grade } from "@/lib/srs/types";

/**
 * There is no sign-in here: the app assumes a single local user, so every action
 * is open to anyone who can reach the server. Server Actions are reachable by
 * direct POST, so add authentication before putting this anywhere public.
 */

export interface FormState {
  ok: boolean;
  message: string;
  /** Lines the import could not use, so the user can fix and re-paste them. */
  details?: string[];
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createDeck(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = text(formData, "name");
  if (name === "") {
    return { ok: false, message: "Give the deck a name." };
  }

  await connectToDatabase();
  const deck = await Deck.create({
    name,
    description: text(formData, "description"),
  });

  revalidatePath("/");
  redirect(`/decks/${String(deck._id)}`);
}

export async function updateDeckSettings(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "deckId");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { ok: false, message: "That deck no longer exists." };
  }

  const steps = parseSteps(text(formData, "learningStepsMinutes"));
  const relearningSteps = parseSteps(text(formData, "relearningStepsMinutes"));

  if (steps.length === 0) {
    return { ok: false, message: "Learning steps need at least one value, in minutes." };
  }

  await connectToDatabase();
  await Deck.findByIdAndUpdate(id, {
    name: text(formData, "name") || undefined,
    description: text(formData, "description"),
    learningStepsMinutes: steps,
    relearningStepsMinutes: relearningSteps,
  });

  revalidatePath("/");
  revalidatePath(`/decks/${id}`);
  return { ok: true, message: "Settings saved." };
}

/** "1, 10" or "1 10" into [1, 10]. Non-numbers and zeroes are dropped. */
function parseSteps(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => Number(part))
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);
}

export async function deleteDeck(formData: FormData): Promise<void> {
  const id = text(formData, "deckId");
  if (!mongoose.Types.ObjectId.isValid(id)) return;

  await connectToDatabase();
  const deckId = new mongoose.Types.ObjectId(id);
  // Delete the cards and history too, or they become unreachable rows.
  await Promise.all([
    Card.deleteMany({ deckId }),
    ReviewLog.deleteMany({ deckId }),
    Deck.findByIdAndDelete(deckId),
  ]);

  revalidatePath("/");
  redirect("/");
}

export async function importCards(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "deckId");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { ok: false, message: "That deck no longer exists." };
  }

  const raw = String(formData.get("text") ?? "");
  const separatorName = text(formData, "separator");
  const separator: SeparatorName =
    separatorName in SEPARATORS ? (separatorName as SeparatorName) : "tab";

  const { cards, skipped } = parseCards(raw, { separator });
  if (cards.length === 0) {
    return {
      ok: false,
      message: skipped.length
        ? "Nothing could be imported from that."
        : "Paste some cards first.",
      details: skipped.map(describeSkipped),
    };
  }

  const result = await addCardsToDeck(id, cards);
  if (!result.ok) {
    return { ok: false, message: "That deck no longer exists." };
  }

  revalidatePath("/");
  revalidatePath(`/decks/${id}`);

  const parts = [`Added ${result.added} ${result.added === 1 ? "card" : "cards"}.`];
  if (result.duplicatesInDeck > 0) {
    parts.push(`${result.duplicatesInDeck} already in the deck.`);
  }
  if (skipped.length > 0) parts.push(`${skipped.length} skipped.`);

  return {
    ok: result.added > 0,
    message: parts.join(" "),
    details: skipped.map(describeSkipped),
  };
}

/** Add a single card from the two-field form on the deck page. */
export async function createCard(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const deckId = text(formData, "deckId");
  const front = text(formData, "front");
  const back = text(formData, "back");

  if (front === "" || back === "") {
    return { ok: false, message: "Fill in both the question and the answer." };
  }

  const result = await addCardsToDeck(deckId, [{ front, back }]);
  if (!result.ok) {
    return { ok: false, message: "That deck no longer exists." };
  }

  revalidatePath("/");
  revalidatePath(`/decks/${deckId}`);

  if (result.rejected.length > 0) {
    return { ok: false, message: result.rejected[0].reason };
  }
  if (result.added === 0) {
    return { ok: false, message: "That question is already in this deck." };
  }

  return { ok: true, message: "Card added." };
}

function describeSkipped(entry: { line: number; text: string; reason: string }): string {
  const preview = entry.text.length > 60 ? `${entry.text.slice(0, 60)}...` : entry.text;
  return `Line ${entry.line}: ${entry.reason} - ${preview}`;
}

export async function deleteCard(formData: FormData): Promise<void> {
  const cardId = text(formData, "cardId");
  const deckId = text(formData, "deckId");
  if (!mongoose.Types.ObjectId.isValid(cardId)) return;

  await connectToDatabase();
  await Promise.all([
    Card.findByIdAndDelete(cardId),
    ReviewLog.deleteMany({ cardId: new mongoose.Types.ObjectId(cardId) }),
  ]);

  revalidatePath("/");
  if (mongoose.Types.ObjectId.isValid(deckId)) revalidatePath(`/decks/${deckId}`);
}

/**
 * Answer one card and hand back whatever comes next.
 *
 * Returning the next card keeps the queue on the server: the client never has
 * to work out whether a one-minute learning step has come back around. The
 * scheduling itself lives in `answerCard`, which is testable on its own.
 */
export async function gradeCard(
  cardId: string,
  grade: Grade,
  elapsedMs: number | null,
  options: QueueOptions = {},
): Promise<NextCardResult> {
  const { deckId } = await answerCard(cardId, grade, elapsedMs);

  revalidatePath("/");
  revalidatePath(`/decks/${deckId}`);

  return getNextCard(deckId, options);
}

/**
 * Put the last answer back and show that card again. The restored card is
 * forced to the front of the queue so the undo is visibly the thing that
 * happened, rather than whatever else happened to be due.
 */
export async function undoLastGrade(
  deckId: string,
  options: QueueOptions = {},
): Promise<NextCardResult> {
  const restored = await undoLastAnswer(deckId);

  revalidatePath("/");
  revalidatePath(`/decks/${deckId}`);

  return getNextCard(deckId, { ...options, prefer: restored ?? undefined });
}

/**
 * Re-read the queue without answering anything. The review screen calls this
 * when a learning step it was counting down to comes due.
 */
export async function refreshQueue(
  deckId: string,
  options: QueueOptions = {},
): Promise<NextCardResult> {
  return getNextCard(deckId, options);
}

/** Remove the card on screen and carry on with the session. */
export async function deleteCardAndContinue(
  cardId: string,
  deckId: string,
  options: QueueOptions = {},
): Promise<NextCardResult> {
  if (!mongoose.Types.ObjectId.isValid(cardId)) return getNextCard(deckId, options);

  await connectToDatabase();
  await Promise.all([
    Card.findByIdAndDelete(cardId),
    ReviewLog.deleteMany({ cardId: new mongoose.Types.ObjectId(cardId) }),
  ]);

  revalidatePath("/");
  revalidatePath(`/decks/${deckId}`);

  return getNextCard(deckId, options);
}
