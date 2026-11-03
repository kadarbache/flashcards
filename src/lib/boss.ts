/**
 * Boss words: a word you keep forgetting comes back as a boss.
 *
 * A card that has lapsed three times or more -- learned, then forgotten in
 * review, again and again -- becomes a boss for a week. Once a day you face
 * it: read the word, flip, and say honestly whether you knew it. Three days in
 * a row and it is beaten: it goes into the trophy case and pays out XP. A miss,
 * or a day without a fight, heals it back to full. A boss not beaten in its
 * week gets away, and can come back later.
 *
 * Like Word of the Day, a fight never touches the card's schedule.
 *
 * This file is the rules, with no database, so it can be tested on its own.
 * Picking and saving a boss lives in `boss-db.ts`.
 */
import { addDays, daysBetween, previousDay } from "@/lib/game";
import type { WordResult } from "@/lib/word-of-the-day";

/** Lapses that make a word a boss. */
export const BOSS_MIN_LAPSES = 3;
/** Days in a row it must be known to be beaten, which are also its hearts. */
export const BOSS_HEARTS = 3;
/** How long a boss stays, in days. The next one comes the day after. */
export const BOSS_DAYS = 7;
/** XP for beating a boss: a little under a day's goal of answers. */
export const BOSS_XP = 150;

export interface BossAnswer {
  day: string;
  result: WordResult;
}

/** What the rules need from a stored boss. */
export interface BossRow {
  startDay: string;
  endDay: string;
  answers: readonly BossAnswer[];
  defeatedOn: string | null;
}

export type BossPhase = "fighting" | "defeated" | "escaped";

export interface BossStatus {
  phase: BossPhase;
  /** Hearts it has left, out of `BOSS_HEARTS`. */
  hearts: number;
  /** Today's fight, once it is fought. */
  today: WordResult | null;
  /** Whether today still has a fight in it. */
  canFight: boolean;
  /** Days of its stay left, today included. */
  daysLeft: number;
  /** Whether it can still be beaten before it leaves. */
  winnable: boolean;
  /** The day the next boss comes. */
  nextBossDay: string;
}

/**
 * Days in a row the boss was known, counting back from the last fight. The
 * run only lives while it is unbroken: a miss ends it, and so does a day with
 * no fight, so the last fight must be today or the day before.
 */
export function hitsInARow(answers: readonly BossAnswer[], today: string): number {
  const sorted = [...answers].sort((a, b) => a.day.localeCompare(b.day));
  const last = sorted[sorted.length - 1];
  if (!last || (last.day !== today && last.day !== previousDay(today))) return 0;

  let run = 0;
  let expected = last.day;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const answer = sorted[index];
    if (answer.day !== expected || answer.result !== "knew") break;
    run += 1;
    expected = previousDay(expected);
  }
  return run;
}

/** Where a boss stands on `today`. */
export function bossStatus(boss: BossRow, today: string): BossStatus {
  const todays = boss.answers.find((answer) => answer.day === today)?.result ?? null;
  const daysLeft = Math.max(0, daysBetween(today, boss.endDay) + 1);
  const nextBossDay = addDays(boss.endDay, 1);

  if (boss.defeatedOn) {
    return { phase: "defeated", hearts: 0, today: todays, canFight: false, daysLeft, winnable: false, nextBossDay };
  }
  if (today > boss.endDay) {
    return { phase: "escaped", hearts: BOSS_HEARTS, today: null, canFight: false, daysLeft: 0, winnable: false, nextBossDay };
  }

  const run = hitsInARow(boss.answers, today);
  const fightsLeft = daysLeft - (todays ? 1 : 0);
  return {
    phase: "fighting",
    hearts: BOSS_HEARTS - run,
    today: todays,
    canFight: todays === null && today >= boss.startDay,
    daysLeft,
    winnable: run + fightsLeft >= BOSS_HEARTS,
    nextBossDay,
  };
}

export interface BossCandidate {
  id: string;
  lapses: number;
}

export interface PastBoss {
  cardId: string;
  /** Lapses when it became a boss. */
  lapses: number;
  defeated: boolean;
}

/**
 * The card to make the next boss, or null when no word qualifies.
 *
 * The word that has slipped most often goes first, ties drawn at random. A
 * beaten boss stays beaten unless it has slipped again since. The boss that
 * just got away sits out a week while there is another word to fight.
 *
 * `past` is newest first.
 */
export function pickBoss(
  candidates: readonly BossCandidate[],
  past: readonly PastBoss[],
  random: () => number = Math.random,
): string | null {
  const beatenAt = new Map<string, number>();
  for (const boss of past) {
    if (boss.defeated) beatenAt.set(boss.cardId, Math.max(beatenAt.get(boss.cardId) ?? 0, boss.lapses));
  }

  const eligible = candidates.filter((card) => {
    if (card.lapses < BOSS_MIN_LAPSES) return false;
    const beaten = beatenAt.get(card.id);
    return beaten === undefined || card.lapses > beaten;
  });

  const last = past[0];
  const rested = eligible.filter((card) => !last || last.defeated || card.id !== last.cardId);
  const pool = rested.length > 0 ? rested : eligible;
  if (pool.length === 0) return null;

  const most = Math.max(...pool.map((card) => card.lapses));
  const top = pool.filter((card) => card.lapses === most);
  return top[Math.min(top.length - 1, Math.floor(random() * top.length))].id;
}
