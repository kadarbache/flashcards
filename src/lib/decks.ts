import mongoose, { type Types } from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, ReviewLog } from "@/lib/db/models";
import { describeState, formatDelay, previewIntervals } from "@/lib/srs/scheduler";
import type { CardState, Grade, ReviewState, SchedulerConfig } from "@/lib/srs/types";

/** States whose cards sit on a minute-scale ladder rather than a day interval. */
const LADDER_STATES: CardState[] = ["learning", "relearning"];

export interface DeckSummary {
  id: string;
  name: string;
  description: string;
  totalCards: number;
  /**
   * The four buckets every card falls into, which always add up to
   * `totalCards`. A card that is mid-ladder or waiting out an interval has to
   * land somewhere, or the row looks like cards have gone missing.
   */
  dueNew: number;
  dueLearning: number;
  dueReview: number;
  scheduled: number;
}

export interface DeckSettings {
  id: string;
  name: string;
  description: string;
  learningStepsMinutes: number[];
  relearningStepsMinutes: number[];
}

export interface CardSummary {
  id: string;
  front: string;
  back: string;
  state: CardState;
  stateLabel: string;
  intervalLabel: string;
  dueLabel: string;
  ease: number;
  lapses: number;
  reps: number;
}

export interface ReviewCardView {
  id: string;
  front: string;
  back: string;
  stateLabel: string;
  /** Button labels: what each grade would do to this card. */
  previews: Record<Grade, string>;
}

export interface QueueCounts {
  newCards: number;
  /** On the learning ladder, whether or not the next step is due yet. */
  learning: number;
  /** Graduated and due now. */
  review: number;
  /** Graduated and waiting out an interval. */
  scheduled: number;
}

export interface QueueOptions {
  /** Cards the user skipped this session; passed back on every call. */
  exclude?: string[];
  /** Serve this card if it is still in the deck. Used right after an undo. */
  prefer?: string;
  /**
   * Draw randomly from the cards that qualify, rather than in a fixed order.
   * On by default: a stable order lets you start recognising a card by its
   * position in the queue instead of by the word on it. Tests turn it off when
   * they need a predictable card.
   */
  shuffle?: boolean;
}

export interface NextCardResult {
  card: ReviewCardView | null;
  counts: QueueCounts;
  /**
   * When the soonest not-yet-due card comes up, as an epoch millisecond value.
   * Null when nothing is waiting at all. The review screen uses this to count
   * down instead of showing a bare empty state.
   */
  nextDueAtMs: number | null;
  reviewedToday: number;
}

function toObjectId(id: string): Types.ObjectId | null {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

/** Local midnight. The "answered today" count resets here. */
function startOfToday(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function listDecks(): Promise<DeckSummary[]> {
  await connectToDatabase();
  const now = new Date();
  const decks = await Deck.find().sort({ name: 1 }).lean();

  return Promise.all(
    decks.map(async (deck) => {
      const deckId = deck._id;
      const [totalCards, learning, dueReview, newRemaining, scheduled] =
        await Promise.all([
          Card.countDocuments({ deckId }),
          // Every ladder card counts, due or not: its next step is minutes away,
          // so it belongs to the session in front of you.
          Card.countDocuments({ deckId, state: { $in: LADDER_STATES } }),
          Card.countDocuments({ deckId, state: "review", due: { $lte: now } }),
          Card.countDocuments({ deckId, state: "new" }),
          // Graduated and waiting out a real interval: days away, not today.
          Card.countDocuments({ deckId, state: "review", due: { $gt: now } }),
        ]);

      return {
        id: String(deckId),
        name: deck.name,
        description: deck.description ?? "",
        totalCards,
        dueNew: newRemaining,
        dueLearning: learning,
        dueReview,
        scheduled,
      };
    }),
  );
}

export async function getDeck(id: string): Promise<DeckSettings | null> {
  const deckId = toObjectId(id);
  if (!deckId) return null;

  await connectToDatabase();
  const deck = await Deck.findById(deckId).lean();
  if (!deck) return null;

  return {
    id: String(deck._id),
    name: deck.name,
    description: deck.description ?? "",
    learningStepsMinutes: deck.learningStepsMinutes,
    relearningStepsMinutes: deck.relearningStepsMinutes,
  };
}

export async function listCards(deckId: string, limit = 200): Promise<CardSummary[]> {
  const id = toObjectId(deckId);
  if (!id) return [];

  await connectToDatabase();
  const now = new Date();
  const cards = await Card.find({ deckId: id })
    .sort({ due: 1, createdAt: 1 })
    .limit(limit)
    .lean();

  return cards.map((card) => ({
    id: String(card._id),
    front: card.front,
    back: card.back,
    state: card.state as CardState,
    stateLabel: describeState(card.state as CardState),
    intervalLabel:
      card.state === "new"
        ? "-"
        : card.intervalDays > 0
          ? `${card.intervalDays}d`
          : "<1d",
    dueLabel:
      card.state === "new"
        ? "-"
        : card.due.getTime() <= now.getTime()
          ? "now"
          : `in ${formatDelay(card.due.getTime() - now.getTime())}`,
    ease: card.ease,
    lapses: card.lapses,
    reps: card.reps,
  }));
}

/** Deck settings translated into scheduler config overrides. */
export function configFor(deck: {
  learningStepsMinutes: number[];
  relearningStepsMinutes: number[];
}): Partial<SchedulerConfig> {
  return {
    learningStepsMinutes: deck.learningStepsMinutes,
    relearningStepsMinutes: deck.relearningStepsMinutes,
  };
}

/**
 * The next card to show, plus the counts behind it.
 *
 * Priority is learning ladder first, then due reviews, then new cards. Learning
 * cards come first because their steps are minutes wide: making someone wait out
 * a queue of reviews would blow straight past a one-minute step.
 */
export async function getNextCard(
  deckIdRaw: string,
  options: QueueOptions = {},
): Promise<NextCardResult> {
  const empty: NextCardResult = {
    card: null,
    counts: { newCards: 0, learning: 0, review: 0, scheduled: 0 },
    nextDueAtMs: null,
    reviewedToday: 0,
  };

  const deckId = toObjectId(deckIdRaw);
  if (!deckId) return empty;

  await connectToDatabase();
  const deck = await Deck.findById(deckId).lean();
  if (!deck) return empty;

  const now = new Date();
  const [learning, dueReview, newRemaining, scheduled, reviewedToday] =
    await Promise.all([
      Card.countDocuments({ deckId, state: { $in: LADDER_STATES } }),
      Card.countDocuments({ deckId, state: "review", due: { $lte: now } }),
      Card.countDocuments({ deckId, state: "new" }),
      Card.countDocuments({ deckId, state: "review", due: { $gt: now } }),
      ReviewLog.countDocuments({ deckId, reviewedAt: { $gte: startOfToday(now) } }),
    ]);

  const counts: QueueCounts = {
    newCards: newRemaining,
    learning,
    review: dueReview,
    scheduled,
  };

  // Skipped cards are a session-only idea, so they are filtered out of the
  // draw but left in the counts: they really are still due.
  const skipped = (options.exclude ?? [])
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const notSkipped = skipped.length > 0 ? { _id: { $nin: skipped } } : {};

  const preferred =
    options.prefer && mongoose.Types.ObjectId.isValid(options.prefer)
      ? await Card.findOne({ deckId, _id: new mongoose.Types.ObjectId(options.prefer) }).lean()
      : null;

  const shuffle = options.shuffle ?? true;

  const next =
    (preferred as StoredCard | null) ??
    // Ladder cards stay in due order even when shuffling. Their steps are
    // minutes wide, so the most overdue one has to come first or a one-minute
    // step drifts into a ten-minute one.
    (await drawCard(
      { deckId, ...notSkipped, state: { $in: LADDER_STATES }, due: { $lte: now } },
      { due: 1 },
      false,
    )) ??
    (await drawCard(
      { deckId, ...notSkipped, state: "review", due: { $lte: now } },
      { due: 1 },
      shuffle,
    )) ??
    (counts.newCards > 0
      ? await drawCard({ deckId, ...notSkipped, state: "new" }, { createdAt: 1 }, shuffle)
      : null);

  if (!next) {
    // Nothing is due. Report when the soonest card wakes up so the screen can
    // count down to it rather than claiming the deck is finished.
    const upcoming = await Card.findOne({ deckId, state: { $ne: "new" } })
      .sort({ due: 1 })
      .lean();
    return {
      card: null,
      counts,
      nextDueAtMs: upcoming ? upcoming.due.getTime() : null,
      reviewedToday,
    };
  }

  return {
    card: {
      id: String(next._id),
      front: next.front,
      back: next.back,
      stateLabel: describeState(next.state as CardState),
      previews: previewIntervals(toReviewState(next), {
        now,
        config: configFor(deck),
      }),
    },
    counts,
    nextDueAtMs: null,
    reviewedToday,
  };
}

/** A stored card as the queue reads it, from either a find or an aggregate. */
type StoredCard = {
  _id: unknown;
  front: string;
  back: string;
  state: string;
  step: number;
  intervalDays: number;
  ease: number;
  due: Date;
  lapses: number;
  reps: number;
};

/**
 * Pick one card matching `filter`.
 *
 * Shuffled draws go through `$sample`, which picks uniformly in the database
 * rather than pulling the whole set back to shuffle it here.
 */
async function drawCard(
  filter: Record<string, unknown>,
  orderedBy: Record<string, 1 | -1>,
  shuffle: boolean,
): Promise<StoredCard | null> {
  if (!shuffle) {
    return (await Card.findOne(filter).sort(orderedBy).lean()) as StoredCard | null;
  }
  const [card] = (await Card.aggregate([
    { $match: filter },
    { $sample: { size: 1 } },
  ])) as StoredCard[];
  return card ?? null;
}

/** The scheduling fields of a stored card, as the scheduler wants them. */
export function toReviewState(card: {
  state: string;
  step: number;
  intervalDays: number;
  ease: number;
  due: Date;
  lapses: number;
  reps: number;
}): ReviewState {
  return {
    state: card.state as CardState,
    step: card.step,
    intervalDays: card.intervalDays,
    ease: card.ease,
    due: card.due,
    lapses: card.lapses,
    reps: card.reps,
  };
}
