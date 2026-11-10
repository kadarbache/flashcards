import { connectToDatabase } from "@/lib/db/connect";
import { Card, DailyWord, Deck } from "@/lib/db/models";
import { dayKey, previousDay, safeTimeZone } from "@/lib/game";
import {
  cannotRestore,
  inRestoreWindow,
  isDayKey,
  isWordResult,
  monthOf,
  NO_REPEAT_DAYS,
  RESTORE_COST,
  RESTORES_PER_MONTH,
  restoreCards,
  wordRecord,
  type RestoreCards,
  type WordRecord,
  type WordResult,
} from "@/lib/word-of-the-day";

/** A word as the Word of the Day screen shows it. */
export interface DailyWordView {
  day: string;
  front: string;
  back: string;
  deckName: string;
  result: WordResult | null;
  /** Brought back with a restore card after its day was missed. */
  restored: boolean;
}

export interface WordOfTheDay {
  /** Null when no word has been learned yet, so there is nothing to pick from. */
  today: DailyWordView | null;
  record: WordRecord;
  /** Earlier days, newest first. */
  history: DailyWordView[];
  restores: RestoreCards;
}

/** How many earlier words the screen lists. */
const HISTORY_SIZE = 14;

/** "Learned" is a card that has graduated: the same cards the deck tiles count as learned. */
const LEARNED = { state: "review" };

type StoredWord = {
  day: string;
  front: string;
  back: string;
  deckName?: string | null;
  result?: string | null;
  restoredOn?: string | null;
};

function toView(word: StoredWord): DailyWordView {
  return {
    day: word.day,
    front: word.front,
    back: word.back,
    deckName: word.deckName ?? "",
    result: isWordResult(word.result) ? word.result : null,
    restored: typeof word.restoredOn === "string",
  };
}

async function sampleLearned(filter: Record<string, unknown>) {
  const [card] = await Card.aggregate<{ _id: unknown; deckId: unknown; front: string; back: string }>([
    { $match: { ...LEARNED, ...filter } },
    { $sample: { size: 1 } },
    { $project: { deckId: 1, front: 1, back: 1 } },
  ]);
  return card ?? null;
}

/**
 * The word for `day`, picking one if the day has none yet.
 *
 * Words from the last few weeks are skipped while there are others to choose
 * from. Two requests racing to pick the same day both land on one row: the
 * insert only happens if the day is still empty, and both read that row back.
 */
async function wordFor(day: string): Promise<StoredWord | null> {
  const existing = await DailyWord.findOne({ day }).lean();
  if (existing) return existing;

  const recent = await DailyWord.find()
    .sort({ day: -1 })
    .limit(NO_REPEAT_DAYS)
    .select({ cardId: 1 })
    .lean();
  const card =
    (await sampleLearned({ _id: { $nin: recent.map((word) => word.cardId) } })) ??
    (await sampleLearned({}));
  if (!card) return null;

  const deck = await Deck.findById(card.deckId).select({ name: 1 }).lean();
  try {
    await DailyWord.updateOne(
      { day },
      {
        $setOnInsert: {
          day,
          cardId: card._id,
          deckId: card.deckId,
          deckName: deck?.name ?? "",
          front: card.front,
          back: card.back,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // Another request inserted the day first: its pick stands.
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  return DailyWord.findOne({ day }).lean();
}

/** The record from every day with a word, as the calendar needs it. */
async function readRecord(today: string): Promise<WordRecord> {
  const all = await DailyWord.find().select({ day: 1, result: 1, restoredOn: 1 }).lean();
  return wordRecord(
    all.map((entry) => ({
      day: entry.day,
      result: isWordResult(entry.result) ? entry.result : null,
      restored: typeof entry.restoredOn === "string",
    })),
    today,
  );
}

/** Restore cards used in `today`'s month. */
async function restoresUsedIn(today: string): Promise<number> {
  const month = monthOf(today);
  return DailyWord.countDocuments({ restoredOn: { $gte: `${month}-01`, $lte: `${month}-31` } });
}

/** XP spent on restores, all time. It comes off the XP to spend, like freezes do. */
export async function restoreXpSpent(): Promise<number> {
  await connectToDatabase();
  const [row] = await DailyWord.aggregate<{ xp: number }>([
    { $match: { restoredOn: { $type: "string" } } },
    { $group: { _id: null, xp: { $sum: { $ifNull: ["$restoreCost", 0] } } } },
  ]);
  return row?.xp ?? 0;
}

/** Today's word, the record and the recent history, on the player's calendar. */
export async function getWordOfTheDay(
  timeZoneRaw: string,
  now: Date = new Date(),
): Promise<WordOfTheDay> {
  await connectToDatabase();
  const today = dayKey(now, safeTimeZone(timeZoneRaw));

  const word = await wordFor(today);
  const [all, used] = await Promise.all([
    DailyWord.find()
      .sort({ day: -1 })
      .select({ day: 1, front: 1, back: 1, deckName: 1, result: 1, restoredOn: 1 })
      .lean(),
    restoresUsedIn(today),
  ]);

  return {
    today: word ? toView(word) : null,
    record: wordRecord(all.map(toView), today),
    history: all
      .filter((entry) => entry.day < today)
      .slice(0, HISTORY_SIZE)
      .map(toView),
    restores: restoreCards(used, today),
  };
}

export type AnswerOutcome =
  | { ok: true; record: WordRecord }
  | { ok: false; message: string };

/**
 * Say whether you knew a day's word. Each day takes one answer. Yesterday's
 * word is still accepted, so a card opened just before midnight can be
 * answered just after it. An older day takes an answer only once a restore
 * card has brought it back.
 */
export async function answerWordOfTheDay(
  day: unknown,
  result: unknown,
  timeZoneRaw: string,
  now: Date = new Date(),
): Promise<AnswerOutcome> {
  if (!isDayKey(day) || !isWordResult(result)) {
    return { ok: false, message: "That answer could not be read." };
  }

  const today = dayKey(now, safeTimeZone(timeZoneRaw));
  if (day > today) return { ok: false, message: "That word's day has not come yet." };

  await connectToDatabase();
  const onTime = day === today || day === previousDay(today);
  const filter = onTime
    ? { day, result: null }
    : { day, result: null, restoredOn: { $type: "string" as const } };
  const updated = await DailyWord.updateOne(filter, { $set: { result, answeredAt: now } });
  if (updated.modifiedCount === 0) {
    if (onTime) return { ok: false, message: "That word was already answered." };
    const row = await DailyWord.findOne({ day }).select({ result: 1 }).lean();
    return {
      ok: false,
      message: row?.result
        ? "That word was already answered."
        : "That word's day is over. Use a restore card to answer it.",
    };
  }

  return { ok: true, record: await readRecord(today) };
}

export type RestoreOutcome =
  | { ok: true; word: DailyWordView; record: WordRecord; restores: RestoreCards }
  | { ok: false; message: string };

/**
 * Use a restore card on a missed day: pay `RESTORE_COST` XP out of
 * `xpToSpend`, and get the day's word back to answer late. A day with no word
 * yet (the app was not opened that day) gets one picked now.
 *
 * Paying comes before the word is shown, so a restore is never a free peek.
 * Asking again for a day already restored but not answered yet costs nothing:
 * it hands the same word back.
 */
export async function restoreWordDay(
  day: unknown,
  xpToSpend: number,
  timeZoneRaw: string,
  now: Date = new Date(),
): Promise<RestoreOutcome> {
  if (!isDayKey(day)) return { ok: false, message: "That day could not be read." };

  await connectToDatabase();
  const today = dayKey(now, safeTimeZone(timeZoneRaw));

  const existing = await DailyWord.findOne({ day }).lean();
  if (existing?.result) return { ok: false, message: "That word was already answered." };
  if (existing && typeof existing.restoredOn === "string") return restored(existing, today);

  const first = await DailyWord.findOne().sort({ day: 1 }).select({ day: 1 }).lean();
  if (!inRestoreWindow(day, today, first?.day ?? null)) {
    if (day >= today) return { ok: false, message: "That day is not over yet." };
    return { ok: false, message: "That day is too far back to restore." };
  }

  const [usedBefore, spentBefore] = await Promise.all([restoresUsedIn(today), restoreXpSpent()]);
  const refusal = cannotRestore(usedBefore, xpToSpend);
  if (refusal) return { ok: false, message: refusal };

  const word = await wordFor(day);
  if (!word) return { ok: false, message: "There are no learned words to bring back yet." };

  const marked = await DailyWord.updateOne(
    { day, result: null, restoredOn: null },
    { $set: { restoredOn: today, restoreCost: RESTORE_COST } },
  );
  if (marked.modifiedCount === 0) {
    // Answered or restored a moment ago by another request.
    const row = await DailyWord.findOne({ day }).lean();
    if (row && !row.result && typeof row.restoredOn === "string") return restored(row, today);
    return { ok: false, message: "That word was already answered." };
  }

  // Two taps at once could both pass the checks above. If together they used
  // more cards than the month has, or more XP than there was, this one is
  // taken back.
  const [usedAfter, spentAfter] = await Promise.all([restoresUsedIn(today), restoreXpSpent()]);
  if (usedAfter > RESTORES_PER_MONTH || spentAfter - spentBefore > xpToSpend) {
    await DailyWord.updateOne({ day, result: null }, { $set: { restoredOn: null, restoreCost: 0 } });
    return { ok: false, message: "That didn't go through. Try again." };
  }

  const row = await DailyWord.findOne({ day }).lean();
  return row ? restored(row, today) : { ok: false, message: "That didn't go through. Try again." };
}

async function restored(word: StoredWord, today: string): Promise<RestoreOutcome> {
  const [record, used] = await Promise.all([readRecord(today), restoresUsedIn(today)]);
  return { ok: true, word: toView(word), record, restores: restoreCards(used, today) };
}
