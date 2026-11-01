/**
 * The word collection: every card earns a rank as you learn it better.
 *
 * - Bronze: learned. The card has graduated to review.
 * - Silver: it holds for three weeks. Its interval is 21 days or more, the
 *   point where flashcard apps usually call a card "mature".
 * - Gold:   it holds for three months. Its interval is 90 days or more.
 *
 * The rank is read straight off the card's schedule, so nothing extra is
 * stored: it rises as you answer Good and Easy, and a lapse (Again) drops the
 * card back to Bronze, because its interval starts over.
 */
import type { CardState } from "@/lib/srs/types";

export const TIERS = ["bronze", "silver", "gold"] as const;
export type Tier = (typeof TIERS)[number];

/** The interval, in days, a card needs for each rank. */
export const TIER_DAYS: Record<Tier, number> = { bronze: 0, silver: 21, gold: 90 };

export const TIER_LABEL: Record<Tier, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

type Scheduled = { state: CardState | string; intervalDays: number };

/** A card's rank, or null when it has not been learned yet. */
export function tierFor(card: Scheduled): Tier | null {
  // New and learning cards have never graduated. A relearning card did, then
  // lapsed; it keeps a place in the collection, at the bottom.
  if (card.state !== "review" && card.state !== "relearning") return null;
  if (card.intervalDays >= TIER_DAYS.gold) return "gold";
  if (card.intervalDays >= TIER_DAYS.silver) return "silver";
  return "bronze";
}

/** The rank after `tier`, or null at the top. */
export function nextTier(tier: Tier | null): Tier | null {
  if (tier === null) return "bronze";
  const index = TIERS.indexOf(tier);
  return index < TIERS.length - 1 ? TIERS[index + 1] : null;
}

/**
 * How far a card is from its next rank, 0 to 1. Gold is 1. A card not learned
 * yet is 0: what it needs is to graduate, which is not a number of days.
 */
export function progressToNext(card: Scheduled): number {
  const tier = tierFor(card);
  const next = nextTier(tier);
  if (next === null) return 1;
  if (tier === null) return 0;
  const from = TIER_DAYS[tier];
  const to = TIER_DAYS[next];
  return Math.max(0, Math.min(1, (card.intervalDays - from) / (to - from)));
}

/** The rank a card was promoted to by an answer, or null if it did not go up. */
export function promotion(before: Scheduled, after: Scheduled): Tier | null {
  const was = tierFor(before);
  const now = tierFor(after);
  if (now === null) return null;
  if (was === null) return now;
  return TIERS.indexOf(now) > TIERS.indexOf(was) ? now : null;
}

export interface TierCounts {
  gold: number;
  silver: number;
  bronze: number;
  /** Not learned yet. */
  locked: number;
  total: number;
}

export function countTiers(cards: ReadonlyArray<Scheduled>): TierCounts {
  const counts: TierCounts = { gold: 0, silver: 0, bronze: 0, locked: 0, total: cards.length };
  for (const card of cards) {
    const tier = tierFor(card);
    if (tier) counts[tier] += 1;
    else counts.locked += 1;
  }
  return counts;
}
