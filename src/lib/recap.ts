/**
 * The weekly recap: what a week of play added up to, Monday to Sunday.
 *
 * Nothing is stored for it. It is read back from the answer history, the
 * cards, Word of the Day and the bosses, so any past week can be shown, and
 * an undone answer drops out of it like it drops out of the XP.
 *
 * This file is the counting, with no database, so it can be tested on its
 * own. Reading the week lives in `recap-db.ts`.
 */
import { addDays, COMBO_PAUSE_MS, weekdayLetter } from "@/lib/game";
import type { WordResult } from "@/lib/word-of-the-day";

/** An answer as the recap needs it. */
export interface RecapAnswer {
  cardId: string;
  deckId: string;
  grade: string;
  /** The day it was given, on the player's calendar. */
  day: string;
  /** When it was given, in milliseconds. */
  at: number;
  xp: number;
  elapsedMs: number | null;
  before: { state: string; intervalDays: number };
  intervalDaysAfter: number;
}

export interface RecapDay {
  day: string;
  letter: string;
  count: number;
  met: boolean;
  isToday: boolean;
  /** Not reached yet: the week is still going. */
  future: boolean;
}

export interface Recap {
  monday: string;
  sunday: string;
  /** "3 – 9 Nov", or "29 Dec – 4 Jan" across a month. */
  range: string;
  /** The week is not over yet. */
  current: boolean;
  answers: number;
  xp: number;
  minutes: number;
  days: RecapDay[];
  daysMet: number;
  goal: number;
  /** The streak at the end of the week, or now for this week. */
  streak: number;
  bestCombo: number;
  /** Cards that graduated: their bronze medal. */
  learned: number;
  silver: number;
  gold: number;
  /** Cards made this week. */
  added: number;
  videos: number;
  word: { knew: number; answered: number };
  /** Bosses beaten this week. */
  bosses: string[];
  /** The most-forgotten word answered right this week. */
  toughest: { front: string; lapses: number } | null;
  /**
   * Answers against the week before, in percent; for the current week, against
   * the week before up to the same moment. Null when there is nothing to compare.
   */
  change: number | null;
  topDeck: { name: string; answers: number } | null;
}

/** Longest a single card counts towards time spent, so a card left on screen does not inflate it. */
const MAX_CARD_MS = 60_000;

/** Interval days for silver and gold, as in the collection. */
const SILVER_DAYS = 21;
const GOLD_DAYS = 90;

/** "3 – 9 Nov" for the week starting `monday`; both months when it spans two. */
export function weekRange(monday: string): string {
  const start = dateParts(monday);
  const end = dateParts(addDays(monday, 6));
  return start.month === end.month
    ? `${start.date} – ${end.date} ${end.month}`
    : `${start.date} ${start.month} – ${end.date} ${end.month}`;
}

const DATE_PARTS = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function dateParts(day: string): { date: string; month: string } {
  const parts = DATE_PARTS.formatToParts(new Date(`${day}T00:00:00Z`));
  return {
    date: parts.find((part) => part.type === "day")?.value ?? "",
    month: parts.find((part) => part.type === "month")?.value ?? "",
  };
}

/** The longest run of answers with no pause longer than the combo allows. */
export function bestCombo(times: readonly number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    run = index > 0 && sorted[index] - sorted[index - 1] <= COMBO_PAUSE_MS ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Medals won by the week's answers, one per card and rank. A card graduating
 * from learning wins bronze; an interval crossing 21 or 90 days wins silver
 * or gold. Again never wins anything.
 */
export function medalsWon(answers: readonly RecapAnswer[]): { learned: number; silver: number; gold: number } {
  const learned = new Set<string>();
  const silver = new Set<string>();
  const gold = new Set<string>();
  for (const answer of answers) {
    if (answer.grade === "again") continue;
    const { state, intervalDays } = answer.before;
    const after = answer.intervalDaysAfter;
    if ((state === "new" || state === "learning") && after >= 1) learned.add(answer.cardId);
    if (state === "review" || state === "relearning") {
      if (intervalDays < SILVER_DAYS && after >= SILVER_DAYS) silver.add(answer.cardId);
      if (intervalDays < GOLD_DAYS && after >= GOLD_DAYS) gold.add(answer.cardId);
    }
  }
  return { learned: learned.size, silver: silver.size, gold: gold.size };
}

export interface WeekInput {
  monday: string;
  today: string;
  goal: number;
  /** Answers given in the week. */
  answers: readonly RecapAnswer[];
  /**
   * How many answers the week before had. For a week still going, only those
   * up to the same moment of that week.
   */
  previousAnswers: number;
  /** Cards made in the week. */
  added: number;
  videos: number;
  words: ReadonlyArray<{ result: WordResult | null }>;
  bosses: ReadonlyArray<{ front: string; xp: number }>;
  toughest: { front: string; lapses: number } | null;
  streak: number;
  deckNames: ReadonlyMap<string, string>;
}

export function summarizeWeek(input: WeekInput): Recap {
  const { monday, today, goal, answers } = input;
  const sunday = addDays(monday, 6);

  const counts = new Map<string, number>();
  const byDeck = new Map<string, number>();
  let xp = 0;
  let spentMs = 0;
  for (const answer of answers) {
    counts.set(answer.day, (counts.get(answer.day) ?? 0) + 1);
    byDeck.set(answer.deckId, (byDeck.get(answer.deckId) ?? 0) + 1);
    xp += answer.xp;
    if (answer.elapsedMs && answer.elapsedMs > 0) spentMs += Math.min(answer.elapsedMs, MAX_CARD_MS);
  }
  for (const boss of input.bosses) xp += boss.xp;

  const days: RecapDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(monday, index);
    const count = counts.get(day) ?? 0;
    return {
      day,
      letter: weekdayLetter(day),
      count,
      met: count >= goal,
      isToday: day === today,
      future: day > today,
    };
  });

  let topDeck: Recap["topDeck"] = null;
  for (const [deckId, count] of byDeck) {
    if (!topDeck || count > topDeck.answers) {
      topDeck = { name: input.deckNames.get(deckId) ?? "A deleted deck", answers: count };
    }
  }

  const answered = input.words.filter((word) => word.result !== null);
  const change =
    input.previousAnswers > 0
      ? Math.round(((answers.length - input.previousAnswers) / input.previousAnswers) * 100)
      : null;

  return {
    monday,
    sunday,
    range: weekRange(monday),
    current: sunday >= today,
    answers: answers.length,
    xp,
    minutes: Math.round(spentMs / 60_000),
    days,
    daysMet: days.filter((day) => day.met).length,
    goal,
    streak: input.streak,
    bestCombo: bestCombo(answers.map((answer) => answer.at)),
    ...medalsWon(answers),
    added: input.added,
    videos: input.videos,
    word: { knew: answered.filter((word) => word.result === "knew").length, answered: answered.length },
    bosses: input.bosses.map((boss) => boss.front),
    toughest: input.toughest,
    change,
    topDeck,
  };
}

/** Whether the week had anything in it at all. */
export function isQuietWeek(recap: Recap): boolean {
  return recap.answers === 0 && recap.added === 0 && recap.word.answered === 0 && recap.bosses.length === 0;
}
