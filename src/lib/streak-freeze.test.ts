/**
 * Streak freezes: when they get spent, and buying them with XP, against an
 * in-process MongoDB.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, Profile, ReviewLog, StreakFreeze } from "@/lib/db/models";
import { getPlayerStats } from "@/lib/stats";
import { cannotBuy, FREEZE_COST, MAX_FREEZES, planFreezes, type HeldFreeze } from "@/lib/streak-freeze";
import { buyFreeze } from "@/lib/streak-freeze-db";

const goal = 20;
const today = "2026-11-07";

function plan(counts: Record<string, number>, held: HeldFreeze[], frozen: string[] = []) {
  return planFreezes({ counts: new Map(Object.entries(counts)), goal, today, frozen: new Set(frozen), held });
}

describe("planFreezes", () => {
  const early: HeldFreeze = { id: "a", boughtDay: "2026-11-01" };
  const later: HeldFreeze = { id: "b", boughtDay: "2026-11-03" };

  it("covers yesterday when it ended without the goal", () => {
    assert.deepEqual(plan({ "2026-11-05": 20 }, [early]), [{ id: "a", day: "2026-11-06" }]);
  });

  it("leaves today alone while it is still going", () => {
    assert.deepEqual(plan({ "2026-11-06": 20, "2026-11-07": 3 }, [early]), []);
  });

  it("covers a gap of two days with two freezes, oldest first", () => {
    assert.deepEqual(plan({ "2026-11-04": 25 }, [later, early]), [
      { id: "a", day: "2026-11-05" },
      { id: "b", day: "2026-11-06" },
    ]);
  });

  it("keeps the freezes when they cannot cover the whole gap", () => {
    assert.deepEqual(plan({ "2026-11-04": 25 }, [early]), []);
  });

  it("does nothing without a streak to save", () => {
    assert.deepEqual(plan({}, [early, later]), []);
    assert.deepEqual(plan({ "2026-11-05": 4 }, [early]), []);
  });

  it("never covers a day missed before the freeze was bought", () => {
    const boughtToday: HeldFreeze = { id: "c", boughtDay: today };
    assert.deepEqual(plan({ "2026-11-05": 20 }, [boughtToday]), []);
  });

  it("carries on from a day an earlier freeze covered", () => {
    assert.deepEqual(plan({ "2026-11-04": 20 }, [later], ["2026-11-05"]), [{ id: "b", day: "2026-11-06" }]);
  });
});

describe("cannotBuy", () => {
  it("needs enough XP and a free slot", () => {
    assert.equal(cannotBuy(0, FREEZE_COST), null);
    assert.match(cannotBuy(0, FREEZE_COST - 1) ?? "", /costs 2,000 XP\. You have 1,999/);
    assert.match(cannotBuy(MAX_FREEZES, 99_999) ?? "", /already hold 2/);
  });
});

describe("streak freezes in the database", () => {
  let mongo: MongoMemoryServer;
  const timeZone = "Africa/Nairobi";
  // 10:00 in Nairobi on Saturday 7 November.
  const now = new Date("2026-11-07T07:00:00Z");

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB = "flashcards_freeze_test";
    await connectToDatabase();
    await StreakFreeze.init();
  }, { timeout: 300_000 });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Card.deleteMany({}),
      Deck.deleteMany({}),
      ReviewLog.deleteMany({}),
      Profile.deleteMany({}),
      StreakFreeze.deleteMany({}),
    ]);
  });

  /** `count` answers worth `xp` each, at noon Nairobi time on `day`. */
  async function answered(day: string, count: number, xp = 10) {
    const deck = await Deck.create({ name: "Vocab" });
    const card = await Card.create({ deckId: deck._id, front: "w", back: "b" });
    const at = new Date(`${day}T09:00:00Z`);
    await ReviewLog.insertMany(
      Array.from({ length: count }, () => ({
        cardId: card._id,
        deckId: deck._id,
        grade: "good",
        before: { state: "new", step: 0, intervalDays: 0, ease: 2.5, due: at, lapses: 0, reps: 0 },
        intervalDaysAfter: 1,
        easeAfter: 2.5,
        reviewedAt: at,
        xp,
      })),
    );
  }

  it("pays for a freeze with XP without lowering the level", async () => {
    await answered("2026-11-06", 25, 100); // 2,500 XP
    const before = await getPlayerStats(timeZone, now);

    assert.deepEqual(await buyFreeze(before.xp, timeZone, now), { ok: true });
    const after = await getPlayerStats(timeZone, now);
    assert.equal(after.xpToSpend, 500);
    assert.equal(after.xp, 2500);
    assert.equal(after.level, before.level);
    assert.equal(after.freezes, 1);

    const again = await buyFreeze(after.xp, timeZone, now);
    assert.equal(again.ok, false);
    assert.equal(await StreakFreeze.countDocuments(), 1);
  });

  it("holds two at most", async () => {
    await answered("2026-11-06", 100, 100);
    const { xp } = await getPlayerStats(timeZone, now);
    assert.equal((await buyFreeze(xp, timeZone, now)).ok, true);
    assert.equal((await buyFreeze(xp, timeZone, now)).ok, true);
    const third = await buyFreeze(xp, timeZone, now);
    assert.equal(third.ok, false);
    assert.equal((await getPlayerStats(timeZone, now)).freezes, 2);
  });

  it("spends a freeze on a missed day and keeps the streak", async () => {
    await answered("2026-11-04", 20, 100);
    await answered("2026-11-05", 20, 100);
    // Bought on the 5th, then the 6th went by with nothing.
    const { xp } = await getPlayerStats(timeZone, new Date("2026-11-05T15:00:00Z"));
    await buyFreeze(xp, timeZone, new Date("2026-11-05T15:00:00Z"));

    const player = await getPlayerStats(timeZone, now);
    assert.equal(player.streak, 2);
    assert.equal(player.freezes, 0);
    assert.equal(player.lastFrozenDay, "2026-11-06");
    assert.equal(player.week.find((day) => day.day === "2026-11-06")?.frozen, true);

    // Reading again spends nothing more.
    const again = await getPlayerStats(timeZone, now);
    assert.equal(again.streak, 2);
    assert.equal(await StreakFreeze.countDocuments({ usedOn: { $type: "string" } }), 1);
  });

  it("does not let a freeze bought after the miss repair it", async () => {
    await answered("2026-11-05", 20, 200);
    const { xp } = await getPlayerStats(timeZone, now);
    await buyFreeze(xp, timeZone, now);

    const player = await getPlayerStats(timeZone, now);
    assert.equal(player.streak, 0);
    assert.equal(player.freezes, 1);
  });

  it("refuses a second freeze for a day another already covers", async () => {
    await StreakFreeze.create({ boughtDay: "2026-11-01", cost: FREEZE_COST, usedOn: "2026-11-06" });
    await assert.rejects(
      StreakFreeze.create({ boughtDay: "2026-11-01", cost: FREEZE_COST, usedOn: "2026-11-06" }),
      (error: { code?: number }) => error.code === 11000,
    );
  });
});
