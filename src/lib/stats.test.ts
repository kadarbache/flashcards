/**
 * The player numbers read back from real answer history, against an in-process
 * MongoDB: XP sums, undo taking XP back, daily counts and the Blitz best.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, Profile, ReviewLog } from "@/lib/db/models";
import { getDeck, recordBlitzScore } from "@/lib/decks";
import { answerCard, undoLastAnswer } from "@/lib/review";
import { getPlayerStats, setDailyGoal } from "@/lib/stats";

let mongo: MongoMemoryServer;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "flashcards_stats_test";
  await connectToDatabase();
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
  ]);
});

async function seedCards(count: number): Promise<{ deckId: string; cardIds: string[] }> {
  const deck = await Deck.create({ name: "Stats deck" });
  const cards = await Card.insertMany(
    Array.from({ length: count }, (_, index) => ({
      deckId: deck._id,
      front: `front ${index}`,
      back: `back ${index}`,
    })),
  );
  return { deckId: String(deck._id), cardIds: cards.map((card) => String(card._id)) };
}

describe("getPlayerStats", () => {
  it("adds up XP from answers, combo included, and undo takes it back", async () => {
    const { deckId, cardIds } = await seedCards(3);
    await answerCard(cardIds[0], "again", null, 1);
    await answerCard(cardIds[1], "good", null, 2);
    await answerCard(cardIds[2], "easy", null, 6);

    let stats = await getPlayerStats("UTC");
    assert.equal(stats.xp, 10 + 10 + 20);
    assert.equal(stats.today, 3);

    await undoLastAnswer(deckId);
    stats = await getPlayerStats("UTC");
    assert.equal(stats.xp, 20);
    assert.equal(stats.today, 2);
  });

  it("counts history rows written before XP existed at the base rate", async () => {
    const { deckId, cardIds } = await seedCards(1);
    await ReviewLog.collection.insertOne({
      cardId: new mongoose.Types.ObjectId(cardIds[0]),
      deckId: new mongoose.Types.ObjectId(deckId),
      grade: "good",
      reviewedAt: new Date(),
    });
    assert.equal((await getPlayerStats("UTC")).xp, 10);
  });

  it("builds the streak from days that met the goal", async () => {
    const { deckId, cardIds } = await seedCards(1);
    await setDailyGoal(5);
    const now = new Date("2026-10-31T12:00:00Z");
    const rows = [];
    for (const daysAgo of [1, 2]) {
      for (let i = 0; i < 5; i++) {
        rows.push({
          cardId: new mongoose.Types.ObjectId(cardIds[0]),
          deckId: new mongoose.Types.ObjectId(deckId),
          grade: "good",
          reviewedAt: new Date(now.getTime() - daysAgo * 86_400_000),
          xp: 10,
        });
      }
    }
    await ReviewLog.collection.insertMany(rows);

    const stats = await getPlayerStats("UTC", now);
    assert.equal(stats.goal, 5);
    assert.equal(stats.streak, 2);
    assert.equal(stats.todayDone, false);
    assert.equal(stats.week[6].isToday, true);
    assert.equal(stats.week[5].met, true);
  });
});

describe("recordBlitzScore", () => {
  it("only ever raises the best score", async () => {
    const { deckId } = await seedCards(1);
    assert.equal(await recordBlitzScore(deckId, 900), 900);
    assert.equal(await recordBlitzScore(deckId, 400), 900);
    assert.equal(await recordBlitzScore(deckId, 1200), 1200);
    assert.equal((await getDeck(deckId))?.blitzBest, 1200);
  });
});
