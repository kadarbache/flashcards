/**
 * The collection: ranks read off a card's schedule, and the rank-up that an
 * answer reports, against an in-process MongoDB.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import {
  countTiers,
  nextTier,
  progressToNext,
  promotion,
  tierFor,
} from "@/lib/collection";
import { getCollection, getCollectionCounts } from "@/lib/collection-db";
import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, ReviewLog } from "@/lib/db/models";
import { answerCard } from "@/lib/review";

describe("tierFor", () => {
  it("leaves cards that have not graduated out", () => {
    assert.equal(tierFor({ state: "new", intervalDays: 0 }), null);
    assert.equal(tierFor({ state: "learning", intervalDays: 0 }), null);
  });

  it("ranks learned cards by how long they hold", () => {
    assert.equal(tierFor({ state: "review", intervalDays: 1 }), "bronze");
    assert.equal(tierFor({ state: "review", intervalDays: 20 }), "bronze");
    assert.equal(tierFor({ state: "review", intervalDays: 21 }), "silver");
    assert.equal(tierFor({ state: "review", intervalDays: 89 }), "silver");
    assert.equal(tierFor({ state: "review", intervalDays: 90 }), "gold");
  });

  it("keeps a lapsed card in the album at Bronze", () => {
    assert.equal(tierFor({ state: "relearning", intervalDays: 1 }), "bronze");
  });
});

describe("progress and promotion", () => {
  it("measures the way to the next rank", () => {
    assert.equal(nextTier(null), "bronze");
    assert.equal(nextTier("gold"), null);
    assert.equal(progressToNext({ state: "new", intervalDays: 0 }), 0);
    assert.equal(progressToNext({ state: "review", intervalDays: 55.5 }), 0.5);
    assert.equal(progressToNext({ state: "review", intervalDays: 200 }), 1);
  });

  it("reports only moves up", () => {
    assert.equal(promotion({ state: "learning", intervalDays: 0 }, { state: "review", intervalDays: 1 }), "bronze");
    assert.equal(promotion({ state: "review", intervalDays: 8 }, { state: "review", intervalDays: 22 }), "silver");
    assert.equal(promotion({ state: "review", intervalDays: 8 }, { state: "review", intervalDays: 19 }), null);
    assert.equal(promotion({ state: "review", intervalDays: 40 }, { state: "relearning", intervalDays: 1 }), null);
  });

  it("counts medals", () => {
    assert.deepEqual(
      countTiers([
        { state: "new", intervalDays: 0 },
        { state: "review", intervalDays: 3 },
        { state: "review", intervalDays: 30 },
        { state: "review", intervalDays: 100 },
        { state: "review", intervalDays: 120 },
      ]),
      { gold: 2, silver: 1, bronze: 1, locked: 1, total: 5 },
    );
  });
});

describe("collection in the database", () => {
  let mongo: MongoMemoryServer;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB = "flashcards_collection_test";
    await connectToDatabase();
  }, { timeout: 300_000 });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([Card.deleteMany({}), Deck.deleteMany({}), ReviewLog.deleteMany({})]);
  });

  it("groups words by deck in alphabetical order with counts", async () => {
    const deck = await Deck.create({ name: "Vocab" });
    await Card.insertMany([
      { deckId: deck._id, front: "zeal", back: "Eagerness.", state: "review", intervalDays: 95 },
      { deckId: deck._id, front: "Annex", back: "To take over.", state: "review", intervalDays: 25 },
      { deckId: deck._id, front: "mellow", back: "Soft.", state: "new" },
    ]);
    await Deck.create({ name: "Empty" });

    const collection = await getCollection();
    assert.equal(collection.decks.length, 1);
    assert.deepEqual(
      collection.decks[0].words.map((word) => word.front),
      ["Annex", "mellow", "zeal"],
    );
    assert.deepEqual(collection.counts, { gold: 1, silver: 1, bronze: 0, locked: 1, total: 3 });
    assert.deepEqual(await getCollectionCounts(), collection.counts);
  });

  it("reports a rank-up when an answer moves a card up", async () => {
    const deck = await Deck.create({ name: "Vocab", learningStepsMinutes: [1] });
    const card = await Card.create({
      deckId: deck._id,
      front: "frank",
      back: "Honest.",
      state: "learning",
      step: 0,
    });

    const graduated = await answerCard(String(card._id), "good");
    assert.deepEqual(graduated.rankUp, { front: "frank", tier: "bronze" });

    await Card.updateOne({ _id: card._id }, { $set: { intervalDays: 10, state: "review" } });
    const climbed = await answerCard(String(card._id), "easy");
    assert.deepEqual(climbed.rankUp, { front: "frank", tier: "silver" });

    const lapsed = await answerCard(String(card._id), "again");
    assert.equal(lapsed.rankUp, null);
  });
});
