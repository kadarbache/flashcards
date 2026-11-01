import { connectToDatabase } from "@/lib/db/connect";
import { Card, DailyWord, Deck } from "@/lib/db/models";
import { dayKey, previousDay, safeTimeZone } from "@/lib/game";
import {
  isDayKey,
  isWordResult,
  NO_REPEAT_DAYS,
  wordRecord,
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
}

export interface WordOfTheDay {
  /** Null when no word has been learned yet, so there is nothing to pick from. */
  today: DailyWordView | null;
  record: WordRecord;
  /** Earlier days, newest first. */
  history: DailyWordView[];
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
};

function toView(word: StoredWord): DailyWordView {
  return {
    day: word.day,
    front: word.front,
    back: word.back,
    deckName: word.deckName ?? "",
    result: isWordResult(word.result) ? word.result : null,
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

/** Today's word, the record and the recent history, on the player's calendar. */
export async function getWordOfTheDay(
  timeZoneRaw: string,
  now: Date = new Date(),
): Promise<WordOfTheDay> {
  await connectToDatabase();
  const today = dayKey(now, safeTimeZone(timeZoneRaw));

  const word = await wordFor(today);
  const all = await DailyWord.find()
    .sort({ day: -1 })
    .select({ day: 1, front: 1, back: 1, deckName: 1, result: 1 })
    .lean();

  return {
    today: word ? toView(word) : null,
    record: wordRecord(all.map(toView), today),
    history: all
      .filter((entry) => entry.day < today)
      .slice(0, HISTORY_SIZE)
      .map(toView),
  };
}

export type AnswerOutcome =
  | { ok: true; record: WordRecord }
  | { ok: false; message: string };

/**
 * Say whether you knew a day's word. Each day takes one answer. Yesterday's
 * word is still accepted, so a card opened just before midnight can be
 * answered just after it.
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
  if (day !== today && day !== previousDay(today)) {
    return { ok: false, message: "That word's day is over." };
  }

  await connectToDatabase();
  const updated = await DailyWord.updateOne(
    { day, result: null },
    { $set: { result, answeredAt: now } },
  );
  if (updated.modifiedCount === 0) {
    return { ok: false, message: "That word was already answered." };
  }

  const all = await DailyWord.find().select({ day: 1, result: 1 }).lean();
  return {
    ok: true,
    record: wordRecord(
      all.map((entry) => ({ day: entry.day, result: isWordResult(entry.result) ? entry.result : null })),
      today,
    ),
  };
}
