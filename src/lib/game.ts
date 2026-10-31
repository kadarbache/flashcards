/**
 * The game layer: XP, levels, combos and streaks.
 *
 * Pure functions only -- no database, no clock of their own -- so the rules can
 * be tested directly. None of this touches scheduling: a card comes back when
 * the scheduler says so, however much XP it was worth.
 *
 * Every answer is worth the same base XP, Again included. Paying more for
 * "Good" would quietly reward grading a forgotten card as remembered, and that
 * is the one thing that breaks spaced repetition.
 */

export const XP_PER_ANSWER = 10;

/** A gap longer than this between two answers ends the combo. */
export const COMBO_PAUSE_MS = 20_000;

export const DEFAULT_DAILY_GOAL = 20;
export const MIN_DAILY_GOAL = 5;
export const MAX_DAILY_GOAL = 200;

/** Answering steadily multiplies XP: x1.5 from 3 in a row, x2 from 6. */
export function multiplierFor(combo: number): number {
  if (combo >= 6) return 2;
  if (combo >= 3) return 1.5;
  return 1;
}

/** XP for one answer given at `combo`. The combo comes from the client, so it is clamped. */
export function xpFor(combo: number): number {
  const safe = Number.isFinite(combo) ? Math.max(0, Math.min(Math.floor(combo), 10_000)) : 0;
  return Math.round(XP_PER_ANSWER * multiplierFor(safe));
}

/** The combo after an answer at `now`: one more, or a fresh start after a long pause. */
export function nextCombo(previous: number, lastAnswerAt: number | null, now: number): number {
  if (lastAnswerAt === null || now - lastAnswerAt > COMBO_PAUSE_MS) return 1;
  return previous + 1;
}

/** XP needed to get from `level` to the next one: 200 at first, 50 more each level. */
export function xpForLevel(level: number): number {
  return 200 + 50 * (level - 1);
}

export interface LevelProgress {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level takes in total. */
  needed: number;
  rank: string;
}

export function levelFromXp(totalXp: number): LevelProgress {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level += 1;
  }
  return { level, into: rest, needed: xpForLevel(level), rank: rankFor(level) };
}

const RANKS: Array<[minLevel: number, name: string]> = [
  [25, "Sage"],
  [15, "Master"],
  [10, "Expert"],
  [6, "Scholar"],
  [3, "Apprentice"],
  [1, "Rookie"],
];

export function rankFor(level: number): string {
  return RANKS.find(([min]) => level >= min)?.[1] ?? "Rookie";
}

export function clampGoal(goal: number): number {
  if (!Number.isFinite(goal)) return DEFAULT_DAILY_GOAL;
  return Math.max(MIN_DAILY_GOAL, Math.min(MAX_DAILY_GOAL, Math.round(goal)));
}

// --- days and streaks --------------------------------------------------------

/** `date` as YYYY-MM-DD on the calendar of `timeZone`. */
export function dayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

/** The calendar day before a YYYY-MM-DD day. */
export function previousDay(day: string): string {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** "M", "T", "W"... for a YYYY-MM-DD day. */
export function weekdayLetter(day: string): string {
  return "SMTWTFS"[parseDay(day).getUTCDay()];
}

/** A time zone name the runtime accepts, or UTC. */
export function safeTimeZone(value: string | null | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

export interface StreakInfo {
  /** Days in a row the goal was met, counting today only once it is met. */
  current: number;
  best: number;
  todayDone: boolean;
}

/**
 * A day counts towards the streak when its answers reach the goal. Today not
 * being done yet does not break anything: the streak runs through yesterday
 * until the day is over.
 */
export function streakFrom(
  counts: ReadonlyMap<string, number>,
  today: string,
  goal: number,
): StreakInfo {
  const met = (day: string) => (counts.get(day) ?? 0) >= goal;
  const todayDone = met(today);

  let current = 0;
  for (let day = todayDone ? today : previousDay(today); met(day); day = previousDay(day)) {
    current += 1;
  }

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of [...counts.keys()].filter(met).sort()) {
    run = previous !== null && previousDay(day) === previous ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }

  return { current, best: Math.max(best, current), todayDone };
}

export interface WeekDay {
  day: string;
  letter: string;
  count: number;
  met: boolean;
  isToday: boolean;
}

/** The seven days ending today, oldest first. */
export function lastSevenDays(
  counts: ReadonlyMap<string, number>,
  today: string,
  goal: number,
): WeekDay[] {
  const days: string[] = [today];
  while (days.length < 7) days.unshift(previousDay(days[0]));
  return days.map((day) => {
    const count = counts.get(day) ?? 0;
    return { day, letter: weekdayLetter(day), count, met: count >= goal, isToday: day === today };
  });
}
