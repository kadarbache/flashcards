/**
 * Word of the Day: once a day, one word you have already learned comes back
 * as a single flashcard. You say whether you knew it, and the days you knew it
 * and the days you missed it are kept.
 *
 * This file is the counting half, with no database, so it can be tested on
 * its own. Picking and saving the word lives in `word-of-the-day-db.ts`.
 */
import { previousDay, streakFrom } from "@/lib/game";

export const WORD_RESULTS = ["knew", "missed"] as const;
export type WordResult = (typeof WORD_RESULTS)[number];

/** How many days the calendar on the Word of the Day screen covers. */
export const CALENDAR_DAYS = 28;

/** A word picked in the last this-many days is not picked again while others remain. */
export const NO_REPEAT_DAYS = 30;

export function isWordResult(value: unknown): value is WordResult {
  return value === "knew" || value === "missed";
}

/** YYYY-MM-DD, the shape every day key in the app has. */
export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export interface CalendarDay {
  day: string;
  /** Day of the month, for the label on the calendar. */
  date: number;
  result: WordResult | null;
  isToday: boolean;
}

export interface WordRecord {
  /** Days you knew the word, all time. */
  knew: number;
  /** Days you missed it, all time. */
  missed: number;
  /** Days in a row you knew it. Today not answered yet does not break it. */
  streak: number;
  bestStreak: number;
  /** The last `CALENDAR_DAYS` days, oldest first, ending today. */
  calendar: CalendarDay[];
}

/** The tallies, streak and calendar from every answered day. */
export function wordRecord(
  history: ReadonlyArray<{ day: string; result: WordResult | null }>,
  today: string,
  span: number = CALENDAR_DAYS,
): WordRecord {
  const results = new Map<string, WordResult>();
  for (const entry of history) {
    if (entry.result) results.set(entry.day, entry.result);
  }

  let knew = 0;
  let missed = 0;
  const knewDays = new Map<string, number>();
  for (const [day, result] of results) {
    if (result === "knew") {
      knew += 1;
      knewDays.set(day, 1);
    } else {
      missed += 1;
    }
  }

  // Same rule as the daily-goal streak, with a goal of one known word a day.
  const streak = streakFrom(knewDays, today, 1);

  const days: string[] = [today];
  while (days.length < span) days.unshift(previousDay(days[0]));

  return {
    knew,
    missed,
    streak: streak.current,
    bestStreak: streak.best,
    calendar: days.map((day) => ({
      day,
      date: Number(day.slice(8, 10)),
      result: results.get(day) ?? null,
      isToday: day === today,
    })),
  };
}
