import { bossXp } from "@/lib/boss-db";
import { connectToDatabase } from "@/lib/db/connect";
import { Profile, ReviewLog } from "@/lib/db/models";
import type { NextCardResult } from "@/lib/decks";
import type { RankUp } from "@/lib/review";
import {
  clampGoal,
  dayKey,
  DEFAULT_DAILY_GOAL,
  lastSevenDays,
  levelFromXp,
  safeTimeZone,
  streakFrom,
  XP_PER_ANSWER,
  type WeekDay,
} from "@/lib/game";
import { readFreezes, settleFreezes } from "@/lib/streak-freeze-db";
import { restoreXpSpent } from "@/lib/word-of-the-day-db";

/** Everything the HUD and the home screen show about the player. */
export interface PlayerStats {
  /** All the XP ever earned. It sets the level, so spending XP never lowers it. */
  xp: number;
  /** XP left to spend: everything earned, less what streak freezes and restore cards cost. */
  xpToSpend: number;
  /** Streak freezes waiting for a missed day. */
  freezes: number;
  /** The latest missed day a freeze covered, or null. */
  lastFrozenDay: string | null;
  level: number;
  /** XP inside the current level, and what the level takes in total. */
  levelInto: number;
  levelNeeded: number;
  rank: string;
  /** Answers today, across every deck, on the player's own calendar. */
  today: number;
  goal: number;
  streak: number;
  bestStreak: number;
  /** Whether today already counts towards the streak. */
  todayDone: boolean;
  week: WeekDay[];
}

/**
 * What the review screen gets back after every move. `rankUp` is only set by
 * an answer that promoted the card in the collection.
 */
export type SessionResult = NextCardResult & { player: PlayerStats; rankUp?: RankUp | null };

/** How far back daily counts are read. Plenty for a streak and a best streak. */
const HISTORY_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function getDailyGoal(): Promise<number> {
  await connectToDatabase();
  const profile = await Profile.findOne({ key: "owner" }).lean();
  return profile ? clampGoal(profile.dailyGoal) : DEFAULT_DAILY_GOAL;
}

export async function setDailyGoal(goal: number): Promise<number> {
  await connectToDatabase();
  const value = clampGoal(goal);
  await Profile.updateOne(
    { key: "owner" },
    { $set: { dailyGoal: value }, $setOnInsert: { key: "owner" } },
    { upsert: true },
  );
  return value;
}

/**
 * XP, level, today's count and the streak, all read from the answer history.
 *
 * Nothing here is stored as a running total: XP is the sum of what each answer
 * earned, plus each beaten boss, so an undo -- which deletes the answer --
 * takes its XP back without any bookkeeping. Days are cut on the player's
 * calendar, not the server's.
 *
 * Reading the streak is also when held streak freezes get spent on days that
 * ended without the goal (see `settleFreezes`).
 */
export async function getPlayerStats(
  timeZoneRaw: string,
  now: Date = new Date(),
): Promise<PlayerStats> {
  const timeZone = safeTimeZone(timeZoneRaw);
  await connectToDatabase();

  const [xpRows, beatenXp, dayRows, goal, bought, restoreSpent] = await Promise.all([
    ReviewLog.aggregate<{ xp: number }>([
      { $group: { _id: null, xp: { $sum: { $ifNull: ["$xp", XP_PER_ANSWER] } } } },
    ]),
    bossXp(),
    ReviewLog.aggregate<{ _id: string; count: number }>([
      { $match: { reviewedAt: { $gte: new Date(now.getTime() - HISTORY_DAYS * DAY_MS) } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$reviewedAt", timezone: timeZone } },
          count: { $sum: 1 },
        },
      },
    ]),
    getDailyGoal(),
    readFreezes(),
    restoreXpSpent(),
  ]);

  const xp = (xpRows[0]?.xp ?? 0) + beatenXp;
  const counts = new Map(dayRows.map((row) => [row._id, row.count]));
  const today = dayKey(now, timeZone);
  const freezes = await settleFreezes(bought, counts, goal, today);
  const streak = streakFrom(counts, today, goal, freezes.frozen);
  const level = levelFromXp(xp);

  return {
    xp,
    // An undo after buying a freeze can take back XP already spent.
    xpToSpend: Math.max(0, xp - freezes.spent - restoreSpent),
    freezes: freezes.held.length,
    lastFrozenDay: [...freezes.frozen].sort().at(-1) ?? null,
    level: level.level,
    levelInto: level.into,
    levelNeeded: level.needed,
    rank: level.rank,
    today: counts.get(today) ?? 0,
    goal,
    streak: streak.current,
    bestStreak: streak.best,
    todayDone: streak.todayDone,
    week: lastSevenDays(counts, today, goal, freezes.frozen),
  };
}
