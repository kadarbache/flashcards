import { connectToDatabase } from "@/lib/db/connect";
import { Boss, Card, DailyWord, Deck, ReviewLog, Transcript } from "@/lib/db/models";
import {
  addDays,
  dayKey,
  isSunday,
  previousDay,
  safeTimeZone,
  streakFrom,
  weekStart,
  XP_PER_ANSWER,
} from "@/lib/game";
import { summarizeWeek, type Recap, type RecapAnswer } from "@/lib/recap";
import { getDailyGoal } from "@/lib/stats";
import { readFreezes } from "@/lib/streak-freeze-db";
import { isDayKey, isWordResult } from "@/lib/word-of-the-day";

export interface RecapPage {
  recap: Recap;
  /** The Monday of the week before, when there is history that far back. */
  previous: string | null;
  /** The Monday of the week after, unless this is the current week. */
  next: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back daily counts are read for the streak, as in the player's stats. */
const STREAK_DAYS = 400;

/** Midnight UTC at the start of a YYYY-MM-DD day. */
function utc(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/**
 * The week a recap shows when none is asked for: on Sunday the week ending
 * today, the rest of the week the last full one.
 */
export function defaultRecapWeek(today: string): string {
  const monday = weekStart(today);
  return isSunday(today) ? monday : addDays(monday, -7);
}

/**
 * The recap for the week holding `weekRaw` (any day of it), or the default
 * week. Never a week after the current one.
 */
export async function getRecap(
  timeZoneRaw: string,
  weekRaw?: string | null,
  now: Date = new Date(),
): Promise<RecapPage> {
  const timeZone = safeTimeZone(timeZoneRaw);
  const today = dayKey(now, timeZone);
  const thisMonday = weekStart(today);
  const asked = isDayKey(weekRaw) ? weekStart(weekRaw) : defaultRecapWeek(today);
  const monday = asked > thisMonday ? thisMonday : asked;
  const sunday = addDays(monday, 6);
  const lastWeek = addDays(monday, -7);

  // Days are cut on the player's calendar, so read a little either side of
  // the two weeks in UTC and sort the rows into days afterwards.
  const from = new Date(utc(lastWeek) - 2 * DAY_MS);
  const to = new Date(utc(sunday) + 3 * DAY_MS);
  const inWeek = (date: Date) => {
    const day = dayKey(date, timeZone);
    return day >= monday && day <= sunday;
  };

  await connectToDatabase();
  const [logs, cards, videos, words, bosses, decks, goal, dayRows, first, freezes] = await Promise.all([
    ReviewLog.find({ reviewedAt: { $gte: from, $lt: to } })
      .select({ cardId: 1, deckId: 1, grade: 1, before: 1, intervalDaysAfter: 1, reviewedAt: 1, elapsedMs: 1, xp: 1 })
      .lean(),
    Card.find({ createdAt: { $gte: from, $lt: to } }).select({ createdAt: 1 }).lean(),
    Transcript.find({ updatedAt: { $gte: from, $lt: to } }).select({ videoId: 1, updatedAt: 1 }).lean(),
    DailyWord.find({ day: { $gte: monday, $lte: sunday } }).select({ result: 1 }).lean(),
    Boss.find({ defeatedOn: { $gte: monday, $lte: sunday } }).sort({ defeatedOn: 1 }).select({ front: 1, xp: 1 }).lean(),
    Deck.find().select({ name: 1 }).lean(),
    getDailyGoal(),
    ReviewLog.aggregate<{ _id: string; count: number }>([
      { $match: { reviewedAt: { $gte: new Date(utc(sunday) - STREAK_DAYS * DAY_MS), $lt: to } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$reviewedAt", timezone: timeZone } },
          count: { $sum: 1 },
        },
      },
    ]),
    ReviewLog.findOne().sort({ reviewedAt: 1 }).select({ reviewedAt: 1 }).lean(),
    readFreezes(),
  ]);

  // A week still going is held against the week before up to this same
  // moment, not all of it, or every Tuesday would look like a slump.
  const comparedUntil = sunday >= today ? now.getTime() - 7 * DAY_MS : Infinity;
  const answers: RecapAnswer[] = [];
  let previousAnswers = 0;
  for (const log of logs) {
    const day = dayKey(log.reviewedAt, timeZone);
    if (day >= lastWeek && day < monday && log.reviewedAt.getTime() <= comparedUntil) previousAnswers += 1;
    if (day < monday || day > sunday) continue;
    answers.push({
      cardId: String(log.cardId),
      deckId: String(log.deckId),
      grade: log.grade,
      day,
      at: log.reviewedAt.getTime(),
      // Rows from before XP existed count at the base rate, as in the player's XP.
      xp: log.xp ?? XP_PER_ANSWER,
      elapsedMs: log.elapsedMs ?? null,
      before: { state: log.before?.state ?? "new", intervalDays: log.before?.intervalDays ?? 0 },
      intervalDaysAfter: log.intervalDaysAfter,
    });
  }

  // The most-forgotten word answered right this week. Its lapses come from
  // the snapshot before the answer, which is what made it hard.
  let hardest: { cardId: unknown; lapses: number } | null = null;
  for (const log of logs) {
    const lapses = log.before?.lapses ?? 0;
    if (log.grade === "again" || lapses < 1 || !inWeek(log.reviewedAt)) continue;
    if (!hardest || lapses > hardest.lapses) hardest = { cardId: log.cardId, lapses };
  }
  const hardestCard = hardest ? await Card.findById(hardest.cardId).select({ front: 1 }).lean() : null;

  const counts = new Map(dayRows.map((row) => [row._id, row.count]));
  const streak =
    sunday >= today
      ? streakFrom(counts, today, goal, freezes.frozen).current
      : runEndingOn(counts, sunday, goal, freezes.frozen);

  const recap = summarizeWeek({
    monday,
    today,
    goal,
    answers,
    previousAnswers,
    added: cards.filter((card) => card.createdAt && inWeek(card.createdAt)).length,
    videos: new Set(videos.filter((video) => video.updatedAt && inWeek(video.updatedAt)).map((video) => video.videoId))
      .size,
    words: words.map((word) => ({ result: isWordResult(word.result) ? word.result : null })),
    bosses: bosses.map((boss) => ({ front: boss.front, xp: boss.xp ?? 0 })),
    toughest: hardest && hardestCard ? { front: hardestCard.front, lapses: hardest.lapses } : null,
    streak,
    deckNames: new Map(decks.map((deck) => [String(deck._id), deck.name])),
  });

  const firstMonday = first ? weekStart(dayKey(first.reviewedAt, timeZone)) : null;
  return {
    recap,
    previous: firstMonday !== null && monday > firstMonday ? lastWeek : null,
    next: monday < thisMonday ? addDays(monday, 7) : null,
  };
}

/**
 * Days in a row the goal was met, ending on `day` itself. A day a streak
 * freeze covered keeps the run going without adding to it.
 */
function runEndingOn(
  counts: ReadonlyMap<string, number>,
  day: string,
  goal: number,
  frozen: ReadonlySet<string>,
): number {
  const met = (at: string) => (counts.get(at) ?? 0) >= goal;
  let run = 0;
  for (let at = day; met(at) || frozen.has(at); at = previousDay(at)) {
    if (met(at)) run += 1;
  }
  return run;
}
