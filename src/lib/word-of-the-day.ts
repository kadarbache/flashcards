/**
 * Word of the Day: once a day, one word you have already learned comes back
 * as a single flashcard. You say whether you knew it, and the days you knew it
 * and the days you missed it are kept.
 *
 * A day that went by without an answer can be restored: a restore card (three
 * a month, each paid for with XP) brings that day's word back to answer late.
 * Knowing it puts the day back in the streak, but it stays marked as restored.
 *
 * This file is the counting half, with no database, so it can be tested on
 * its own. Picking and saving the word lives in `word-of-the-day-db.ts`.
 */
import { addDays, previousDay, streakFrom } from "@/lib/game";

export const WORD_RESULTS = ["knew", "missed"] as const;
export type WordResult = (typeof WORD_RESULTS)[number];

/** How many days the calendar on the Word of the Day screen covers. */
export const CALENDAR_DAYS = 28;

/** A word picked in the last this-many days is not picked again while others remain. */
export const NO_REPEAT_DAYS = 30;

/** What restoring a missed day costs, in XP. */
export const RESTORE_COST = 1000;

/** Restore cards you get each calendar month. Unused ones do not carry over. */
export const RESTORES_PER_MONTH = 3;

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
  /** A restore card was used on this day, so its answer came (or will come) late. */
  restored: boolean;
  /** A missed day a restore card could still bring back. */
  canRestore: boolean;
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

export interface HistoryEntry {
  day: string;
  result: WordResult | null;
  restored?: boolean;
}

/**
 * Whether a missed day can be restored: it is over, it is on the calendar, and
 * it is not from before the first word ever picked (nothing was missed then).
 * Whether it was answered, and whether a card is left, is checked elsewhere.
 */
export function inRestoreWindow(day: string, today: string, firstDay: string | null): boolean {
  if (firstDay === null || day < firstDay) return false;
  return day < today && day >= addDays(today, -(CALENDAR_DAYS - 1));
}

/** The tallies, streak and calendar from every day with a word. */
export function wordRecord(
  history: ReadonlyArray<HistoryEntry>,
  today: string,
  span: number = CALENDAR_DAYS,
): WordRecord {
  const results = new Map<string, WordResult>();
  const restored = new Set<string>();
  let firstDay: string | null = null;
  for (const entry of history) {
    if (entry.result) results.set(entry.day, entry.result);
    if (entry.restored) restored.add(entry.day);
    if (firstDay === null || entry.day < firstDay) firstDay = entry.day;
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
  // A restored day that was known counts like any other.
  const streak = streakFrom(knewDays, today, 1);

  const days: string[] = [today];
  while (days.length < span) days.unshift(previousDay(days[0]));

  return {
    knew,
    missed,
    streak: streak.current,
    bestStreak: streak.best,
    calendar: days.map((day) => {
      const result = results.get(day) ?? null;
      return {
        day,
        date: Number(day.slice(8, 10)),
        result,
        restored: restored.has(day),
        canRestore: result === null && !restored.has(day) && inRestoreWindow(day, today, firstDay),
        isToday: day === today,
      };
    }),
  };
}

/** "2026-11-10" -> "2026-11", the month a restore card is counted against. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The first day of the month after `day`'s, when new restore cards arrive. */
export function nextMonthStart(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** The restore cards for the month `today` is in. */
export interface RestoreCards {
  /** Cards still unused this month. */
  left: number;
  perMonth: number;
  /** XP one restore costs. */
  cost: number;
  /** The day the month's cards come back, YYYY-MM-DD. */
  renewsOn: string;
}

export function restoreCards(usedThisMonth: number, today: string): RestoreCards {
  return {
    left: Math.max(0, RESTORES_PER_MONTH - usedThisMonth),
    perMonth: RESTORES_PER_MONTH,
    cost: RESTORE_COST,
    renewsOn: nextMonthStart(today),
  };
}

/** Why a restore cannot be used right now, or null when it can. */
export function cannotRestore(usedThisMonth: number, xpToSpend: number): string | null {
  if (usedThisMonth >= RESTORES_PER_MONTH) {
    return `You have used all ${RESTORES_PER_MONTH} restore cards this month.`;
  }
  if (xpToSpend < RESTORE_COST) {
    return `A restore costs ${RESTORE_COST.toLocaleString("en-US")} XP. You have ${xpToSpend.toLocaleString("en-US")}.`;
  }
  return null;
}
