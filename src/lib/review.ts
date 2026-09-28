import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, ReviewLog } from "@/lib/db/models";
import { configFor, toReviewState } from "@/lib/decks";
import { review } from "@/lib/srs/scheduler";
import { GRADES, type Grade } from "@/lib/srs/types";

/**
 * Answer one stored card: run it through the scheduler, save the new state and
 * write the history row.
 *
 * Kept out of the Server Action so it can be tested against a real database
 * without a request context. The action is a thin wrapper that adds cache
 * revalidation on top.
 */
export async function answerCard(
  cardId: string,
  grade: Grade,
  elapsedMs: number | null = null,
): Promise<{ deckId: string }> {
  if (!mongoose.Types.ObjectId.isValid(cardId)) {
    throw new Error("Unknown card.");
  }
  if (!GRADES.includes(grade)) {
    throw new Error(`Unknown grade: ${grade}`);
  }

  await connectToDatabase();

  const card = await Card.findById(cardId);
  if (!card) throw new Error("Unknown card.");

  const deck = await Deck.findById(card.deckId).lean();
  if (!deck) throw new Error("Unknown deck.");

  const before = toReviewState(card);
  const after = review(before, grade, { config: configFor(deck) });

  card.set({
    state: after.state,
    step: after.step,
    intervalDays: after.intervalDays,
    ease: after.ease,
    due: after.due,
    lapses: after.lapses,
    reps: after.reps,
  });

  // The history row goes first, deliberately. These two writes are not atomic
  // (transactions would need a replica set, which rules out a standalone test
  // server), so the order decides what a half-failure leaves behind. Log first
  // means a failed log leaves the card untouched and the answer simply does not
  // count; card first would mutate the card with no way to undo it and no entry
  // against the daily new-card cap.
  const log = await ReviewLog.create({
    cardId: card._id,
    deckId: card.deckId,
    grade,
    before,
    intervalDaysAfter: after.intervalDays,
    easeAfter: after.ease,
    elapsedMs: elapsedMs !== null && elapsedMs > 0 ? Math.round(elapsedMs) : null,
  });

  try {
    await card.save();
  } catch (error) {
    // Roll the log back so it cannot be undone into a state that never happened.
    await ReviewLog.findByIdAndDelete(log._id);
    throw error;
  }

  return { deckId: String(card.deckId) };
}

/**
 * Undo the most recent answer in a deck.
 *
 * The card is restored from the snapshot taken before that answer and the
 * history row is dropped. Returns the card that was put back, so the screen can
 * show it again, or null when there is nothing to undo.
 */
export async function undoLastAnswer(deckId: string): Promise<string | null> {
  if (!mongoose.Types.ObjectId.isValid(deckId)) return null;

  await connectToDatabase();

  const last = await ReviewLog.findOne({ deckId: new mongoose.Types.ObjectId(deckId) })
    .sort({ reviewedAt: -1 })
    .lean();
  // A row with no snapshot cannot be undone: restoring half a card would be
  // worse than refusing.
  if (!last?.before) return null;
  const { before } = last;

  await Card.findByIdAndUpdate(last.cardId, {
    state: before.state,
    step: before.step,
    intervalDays: before.intervalDays,
    ease: before.ease,
    due: before.due,
    lapses: before.lapses,
    reps: before.reps,
  });
  await ReviewLog.findByIdAndDelete(last._id);

  return String(last.cardId);
}
