/**
 * Boss words: the rules on their own, then choosing and fighting bosses
 * against an in-process MongoDB.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { BOSS_XP, bossStatus, hitsInARow, pickBoss, type BossAnswer } from "@/lib/boss";
import { fightBoss, getBossScreen } from "@/lib/boss-db";
import { connectToDatabase } from "@/lib/db/connect";
import { Boss, Card, Deck, ReviewLog } from "@/lib/db/models";
import { getPlayerStats } from "@/lib/stats";

const knew = (day: string): BossAnswer => ({ day, result: "knew" });
const missed = (day: string): BossAnswer => ({ day, result: "missed" });

describe("hitsInARow", () => {
  it("counts days in a row known, back from the last fight", () => {
    assert.equal(hitsInARow([knew("2026-11-02"), knew("2026-11-03")], "2026-11-03"), 2);
    assert.equal(hitsInARow([missed("2026-11-02"), knew("2026-11-03")], "2026-11-03"), 1);
    assert.equal(hitsInARow([knew("2026-11-02"), missed("2026-11-03")], "2026-11-03"), 0);
  });

  it("keeps yesterday's run alive until today is over", () => {
    assert.equal(hitsInARow([knew("2026-11-01"), knew("2026-11-02")], "2026-11-03"), 2);
  });

  it("lets a day without a fight heal the boss", () => {
    assert.equal(hitsInARow([knew("2026-11-01"), knew("2026-11-02")], "2026-11-04"), 0);
    assert.equal(hitsInARow([knew("2026-11-01"), knew("2026-11-03")], "2026-11-03"), 1);
  });
});

describe("bossStatus", () => {
  const boss = { startDay: "2026-11-02", endDay: "2026-11-08", answers: [] as BossAnswer[], defeatedOn: null };

  it("starts at full health with a fight waiting", () => {
    const status = bossStatus(boss, "2026-11-02");
    assert.equal(status.phase, "fighting");
    assert.equal(status.hearts, 3);
    assert.equal(status.canFight, true);
    assert.equal(status.daysLeft, 7);
    assert.equal(status.winnable, true);
    assert.equal(status.nextBossDay, "2026-11-09");
  });

  it("loses a heart a day it is known, and allows one fight a day", () => {
    const status = bossStatus({ ...boss, answers: [knew("2026-11-02"), knew("2026-11-03")] }, "2026-11-03");
    assert.equal(status.hearts, 1);
    assert.equal(status.today, "knew");
    assert.equal(status.canFight, false);
  });

  it("says when there are too few days left to win", () => {
    assert.equal(bossStatus(boss, "2026-11-06").winnable, true); // the 6th, 7th and 8th
    assert.equal(bossStatus(boss, "2026-11-07").winnable, false);
    const twoHits = { ...boss, answers: [knew("2026-11-06"), knew("2026-11-07")] };
    assert.equal(bossStatus(twoHits, "2026-11-08").winnable, true);
  });

  it("gets away once its week is over", () => {
    const status = bossStatus(boss, "2026-11-09");
    assert.equal(status.phase, "escaped");
    assert.equal(status.canFight, false);
  });

  it("stays beaten", () => {
    const status = bossStatus({ ...boss, defeatedOn: "2026-11-04" }, "2026-11-05");
    assert.equal(status.phase, "defeated");
    assert.equal(status.hearts, 0);
    assert.equal(status.daysLeft, 4);
  });
});

describe("pickBoss", () => {
  const first = () => 0;

  it("needs three lapses", () => {
    assert.equal(pickBoss([{ id: "a", lapses: 2 }], []), null);
    assert.equal(pickBoss([{ id: "a", lapses: 3 }], []), "a");
  });

  it("picks the word that slipped most often", () => {
    const candidates = [
      { id: "a", lapses: 3 },
      { id: "b", lapses: 6 },
      { id: "c", lapses: 4 },
    ];
    assert.equal(pickBoss(candidates, [], first), "b");
  });

  it("leaves a beaten boss alone unless it slipped again", () => {
    const beaten = [{ cardId: "b", lapses: 6, defeated: true }];
    const candidates = [
      { id: "a", lapses: 3 },
      { id: "b", lapses: 6 },
    ];
    assert.equal(pickBoss(candidates, beaten, first), "a");
    assert.equal(pickBoss([{ id: "b", lapses: 7 }], beaten, first), "b");
  });

  it("rests a boss that got away while there is another, and brings it back when there is not", () => {
    const escaped = [{ cardId: "b", lapses: 6, defeated: false }];
    assert.equal(pickBoss([{ id: "a", lapses: 3 }, { id: "b", lapses: 6 }], escaped, first), "a");
    assert.equal(pickBoss([{ id: "b", lapses: 6 }], escaped, first), "b");
  });
});

describe("bosses in the database", () => {
  let mongo: MongoMemoryServer;
  const at = (day: string) => new Date(`${day}T12:00:00Z`);

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB = "flashcards_boss_test";
    await connectToDatabase();
    await Boss.init();
  }, { timeout: 300_000 });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([Card.deleteMany({}), Deck.deleteMany({}), Boss.deleteMany({}), ReviewLog.deleteMany({})]);
  });

  async function seed(lapses: number[]) {
    const deck = await Deck.create({ name: "Vocab" });
    await Card.insertMany(
      lapses.map((count, i) => ({
        deckId: deck._id,
        front: `word-${i}`,
        back: `meaning ${i}`,
        state: "review",
        intervalDays: 2,
        lapses: count,
      })),
    );
  }

  it("has no boss until a word has slipped three times, and says which is closest", async () => {
    await seed([1, 2]);
    const screen = await getBossScreen("UTC", at("2026-11-02"));
    assert.equal(screen.boss, null);
    assert.deepEqual(screen.closest, { front: "word-1", lapses: 2 });
    assert.equal(await Boss.countDocuments(), 0);
  });

  it("brings the worst word as the boss, and keeps it all week", async () => {
    await seed([3, 5, 1]);
    const monday = await getBossScreen("UTC", at("2026-11-02"));
    assert.equal(monday.boss?.front, "word-1");
    assert.equal(monday.boss?.lapses, 5);
    assert.equal(monday.boss?.endDay, "2026-11-08");
    assert.equal(monday.boss?.deckName, "Vocab");

    const sunday = await getBossScreen("UTC", at("2026-11-08"));
    assert.equal(sunday.boss?.startDay, "2026-11-02");
    assert.equal(await Boss.countDocuments(), 1);
  });

  it("is beaten by three days in a row, and pays XP", async () => {
    await seed([4]);
    const { boss } = await getBossScreen("UTC", at("2026-11-02"));
    assert.ok(boss);

    const one = await fightBoss(boss.startDay, "2026-11-02", "knew", "UTC", at("2026-11-02"));
    assert.equal(one.ok && one.status.hearts, 2);
    const two = await fightBoss(boss.startDay, "2026-11-03", "knew", "UTC", at("2026-11-03"));
    assert.equal(two.ok && two.defeated, false);
    const three = await fightBoss(boss.startDay, "2026-11-04", "knew", "UTC", at("2026-11-04"));
    assert.equal(three.ok && three.defeated, true);
    assert.equal(three.ok && three.xp, BOSS_XP);
    assert.equal(three.ok && three.status.phase, "defeated");

    assert.equal((await getPlayerStats("UTC", at("2026-11-04"))).xp, BOSS_XP);
    const screen = await getBossScreen("UTC", at("2026-11-05"));
    assert.equal(screen.trophies.length, 1);
    assert.equal(screen.trophies[0].defeatedOn, "2026-11-04");
  });

  it("heals on a miss and takes one fight a day", async () => {
    await seed([4]);
    const { boss } = await getBossScreen("UTC", at("2026-11-02"));
    assert.ok(boss);

    await fightBoss(boss.startDay, "2026-11-02", "knew", "UTC", at("2026-11-02"));
    const again = await fightBoss(boss.startDay, "2026-11-02", "knew", "UTC", at("2026-11-02"));
    assert.equal(again.ok, false);

    const miss = await fightBoss(boss.startDay, "2026-11-03", "missed", "UTC", at("2026-11-03"));
    assert.equal(miss.ok && miss.status.hearts, 3);
  });

  it("accepts yesterday's fight just after midnight, but nothing older or after its week", async () => {
    await seed([4]);
    const { boss } = await getBossScreen("UTC", at("2026-11-02"));
    assert.ok(boss);

    const late = await fightBoss(boss.startDay, "2026-11-02", "knew", "UTC", new Date("2026-11-03T00:10:00Z"));
    assert.equal(late.ok, true);
    assert.equal((await fightBoss(boss.startDay, "2026-11-01", "knew", "UTC", at("2026-11-02"))).ok, false);
    assert.equal((await fightBoss(boss.startDay, "2026-11-09", "knew", "UTC", at("2026-11-09"))).ok, false);
    assert.equal((await fightBoss("monday", "2026-11-03", "knew", "UTC", at("2026-11-03"))).ok, false);
  });

  it("lets a boss get away after its week, and brings a new one", async () => {
    await seed([4, 3]);
    const first = await getBossScreen("UTC", at("2026-11-02"));
    assert.equal(first.boss?.front, "word-0");

    const later = await getBossScreen("UTC", at("2026-11-10"));
    assert.equal(later.boss?.startDay, "2026-11-10");
    assert.equal(later.boss?.front, "word-1");
    assert.equal(later.escaped, 1);
  });

  it("keeps the trophy after its card is deleted", async () => {
    await seed([4]);
    const { boss } = await getBossScreen("UTC", at("2026-11-02"));
    assert.ok(boss);
    for (const day of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
      await fightBoss(boss.startDay, day, "knew", "UTC", at(day));
    }
    await Card.deleteMany({});
    const screen = await getBossScreen("UTC", at("2026-11-20"));
    assert.equal(screen.boss, null);
    assert.equal(screen.trophies[0]?.front, "word-0");
  });
});
