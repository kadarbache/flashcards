/**
 * Streak freezes: bought with XP, held until a day ends without the goal, and
 * then spent on that day so the streak survives it.
 *
 * Pure rules only, so they can be tested directly. Storing and buying live in
 * `streak-freeze-db.ts`.
 */

import { previousDay } from "@/lib/game";

/** What one freeze costs, in XP. */
export const FREEZE_COST = 2000;

/** How many freezes can wait at once. */
export const MAX_FREEZES = 2;

/** A freeze not used yet, and the day it was bought on the player's calendar. */
export interface HeldFreeze {
  id: string;
  boughtDay: string;
}

export interface FreezeUse {
  id: string;
  /** The missed day it covers. */
  day: string;
}

/**
 * Which held freezes to spend now, and on which missed days.
 *
 * The days missed since the streak was last kept (today aside, which is not
 * over) are covered all together or not at all: when the freezes held cannot
 * cover every one of them, the streak is gone either way, so they are kept for
 * the next one. A freeze covers the day it was bought and later days, never a
 * day missed before it was bought.
 */
export function planFreezes(input: {
  counts: ReadonlyMap<string, number>;
  goal: number;
  today: string;
  frozen: ReadonlySet<string>;
  held: readonly HeldFreeze[];
}): FreezeUse[] {
  const { counts, goal, today, frozen, held } = input;
  const kept = (day: string) => (counts.get(day) ?? 0) >= goal || frozen.has(day);

  // Missed days, newest first, back to the last day the streak was kept. The
  // walk stops as soon as there are more of them than freezes, which also
  // covers having no streak at all.
  const missed: string[] = [];
  for (let day = previousDay(today); !kept(day); day = previousDay(day)) {
    missed.push(day);
    if (missed.length > held.length) return [];
  }
  if (missed.length === 0) return [];

  // Oldest day first, oldest freeze first: the earliest freeze that may cover
  // a day takes it, which leaves the later ones for the later days.
  const free = [...held].sort((a, b) => a.boughtDay.localeCompare(b.boughtDay) || a.id.localeCompare(b.id));
  const uses: FreezeUse[] = [];
  for (const day of missed.reverse()) {
    const index = free.findIndex((freeze) => freeze.boughtDay <= day);
    if (index === -1) return [];
    uses.push({ id: free[index].id, day });
    free.splice(index, 1);
  }
  return uses;
}

/** Why a freeze cannot be bought right now, or null when it can. */
export function cannotBuy(held: number, xpToSpend: number): string | null {
  if (held >= MAX_FREEZES) return `You already hold ${MAX_FREEZES} freezes, the most you can.`;
  if (xpToSpend < FREEZE_COST) {
    return `A freeze costs ${FREEZE_COST.toLocaleString("en-US")} XP. You have ${xpToSpend.toLocaleString("en-US")}.`;
  }
  return null;
}
