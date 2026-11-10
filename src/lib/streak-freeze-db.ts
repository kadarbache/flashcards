import { connectToDatabase } from "@/lib/db/connect";
import { StreakFreeze } from "@/lib/db/models";
import { dayKey, safeTimeZone } from "@/lib/game";
import {
  cannotBuy,
  FREEZE_COST,
  MAX_FREEZES,
  planFreezes,
  type HeldFreeze,
} from "@/lib/streak-freeze";

/** Every freeze bought, as the streak and the XP need them. */
export interface Freezes {
  /** Freezes waiting to be used. */
  held: HeldFreeze[];
  /** XP spent on freezes in all, used or not. */
  spent: number;
  /** Missed days a freeze covered. */
  frozen: Set<string>;
}

export async function readFreezes(): Promise<Freezes> {
  await connectToDatabase();
  const rows = await StreakFreeze.find().select({ boughtDay: 1, cost: 1, usedOn: 1 }).lean();
  const freezes: Freezes = { held: [], spent: 0, frozen: new Set() };
  for (const row of rows) {
    freezes.spent += row.cost;
    if (typeof row.usedOn === "string") freezes.frozen.add(row.usedOn);
    else freezes.held.push({ id: String(row._id), boughtDay: row.boughtDay });
  }
  return freezes;
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

/**
 * Spend held freezes on the days missed since the streak was last kept, when
 * they can save it, and return the freezes as they then stand.
 *
 * Runs whenever the streak is read, so a freeze is spent the first time the
 * app looks after a missed day has ended: on opening it, or at the evening
 * reminder.
 */
export async function settleFreezes(
  freezes: Freezes,
  counts: ReadonlyMap<string, number>,
  goal: number,
  today: string,
): Promise<Freezes> {
  const uses = planFreezes({ counts, goal, today, frozen: freezes.frozen, held: freezes.held });
  if (uses.length === 0) return freezes;

  await Promise.all(
    uses.map(({ id, day }) =>
      StreakFreeze.updateOne({ _id: id, usedOn: null }, { $set: { usedOn: day } }).catch((error: unknown) => {
        // Another request covered this day a moment earlier.
        if (!isDuplicateKey(error)) throw error;
      }),
    ),
  );
  return readFreezes();
}

export type BuyOutcome = { ok: true } | { ok: false; message: string };

/**
 * Buy one freeze. It is paid from `earnedXp`, the XP earned so far (less what
 * restore cards cost), less what earlier freezes cost.
 */
export async function buyFreeze(
  earnedXp: number,
  timeZone: string,
  now: Date = new Date(),
): Promise<BuyOutcome> {
  const before = await readFreezes();
  const refusal = cannotBuy(before.held.length, earnedXp - before.spent);
  if (refusal) return { ok: false, message: refusal };

  const bought = await StreakFreeze.create({
    boughtDay: dayKey(now, safeTimeZone(timeZone)),
    cost: FREEZE_COST,
  });

  // Two taps at once could both pass the check above. If together they went
  // over the limit or past the XP there was, this one is taken back.
  const after = await readFreezes();
  if (after.held.length > MAX_FREEZES || after.spent > earnedXp) {
    await StreakFreeze.deleteOne({ _id: bought._id });
    return { ok: false, message: "That didn't go through. Try again." };
  }
  return { ok: true };
}
