/**
 * Word of the Day: the record from answered days, then picking and answering
 * against an in-process MongoDB.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, DailyWord, Deck } from "@/lib/db/models";
import { wordRecord } from "@/lib/word-of-the-day";
import { answerWordOfTheDay, getWordOfTheDay } from "@/lib/word-of-the-day-db";

describe("wordRecord", () => {
  it("counts known and missed days and ignores unanswered ones", () => {
    const record = wordRecord(
      [
        { day: "2026-10-28", result: "knew" },
        { day: "2026-10-29", result: "missed" },
        { day: "2026-10-30", result: "knew" },
        { day: "2026-10-31", result: null },
      ],
      "2026-11-01",
    );
    assert.equal(record.knew, 2);
    assert.equal(record.missed, 1);
  });

  it("keeps the streak through yesterday until today is answered", () => {
    const history = [
      { day: "2026-10-30", result: "knew" as const },
      { day: "2026-10-31", result: "knew" as const },
    ];
    assert.equal(wordRecord(history, "2026-11-01").streak, 2);
    assert.equal(
      wordRecord([...history, { day: "2026-11-01", result: "knew" }], "2026-11-01").streak,
      3,
    );
  });

  it("breaks the streak on a miss but keeps the best", () => {
    const record = wordRecord(
      [
        { day: "2026-10-27", result: "knew" },
        { day: "2026-10-28", result: "knew" },
        { day: "2026-10-29", result: "knew" },
        { day: "2026-10-30", result: "missed" },
        { day: "2026-10-31", result: "knew" },
      ],
      "2026-11-01",
    );
    assert.equal(record.streak, 1);
    assert.equal(record.bestStreak, 3);
  });

  it("lays out the calendar oldest first, ending today, across a month end", () => {
    const record = wordRecord([{ day: "2026-10-31", result: "missed" }], "2026-11-01", 3);
    assert.deepEqual(
      record.calendar.map((day) => [day.day, day.date, day.result, day.isToday]),
      [
        ["2026-10-30", 30, null, false],
        ["2026-10-31", 31, "missed", false],
        ["2026-11-01", 1, null, true],
      ],
    );
  });
});

describe("Word of the Day in the database", () => {
  let mongo: MongoMemoryServer;
  const now = new Date("2026-11-01T12:00:00Z");

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB = "flashcards_word_test";
    await connectToDatabase();
    await DailyWord.init();
  }, { timeout: 300_000 });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([Card.deleteMany({}), Deck.deleteMany({}), DailyWord.deleteMany({})]);
  });

  async function seed(learned: number, fresh = 0) {
    const deck = await Deck.create({ name: "Vocab" });
    const cards = [
      ...Array.from({ length: learned }, (_, i) => ({
        deckId: deck._id,
        front: `learned-${i}`,
        back: `(Noun) meaning ${i}`,
        state: "review",
        intervalDays: 5,
      })),
      ...Array.from({ length: fresh }, (_, i) => ({
        deckId: deck._id,
        front: `new-${i}`,
        back: `new meaning ${i}`,
      })),
    ];
    await Card.insertMany(cards);
    return deck;
  }

  it("has no word when nothing has been learned", async () => {
    await seed(0, 5);
    const data = await getWordOfTheDay("UTC", now);
    assert.equal(data.today, null);
    assert.equal(await DailyWord.countDocuments(), 0);
  });

  it("picks only learned words, and the same one all day", async () => {
    await seed(3, 20);
    const first = await getWordOfTheDay("UTC", now);
    assert.ok(first.today?.front.startsWith("learned-"));
    assert.equal(first.today?.deckName, "Vocab");

    const again = await getWordOfTheDay("UTC", new Date("2026-11-01T22:00:00Z"));
    assert.equal(again.today?.front, first.today?.front);
    assert.equal(await DailyWord.countDocuments(), 1);
  });

  it("follows the player's calendar, not UTC", async () => {
    await seed(3);
    // 23:00 UTC on 1 Nov is already 2 Nov in Tokyo.
    const data = await getWordOfTheDay("Asia/Tokyo", new Date("2026-11-01T23:00:00Z"));
    assert.equal(data.today?.day, "2026-11-02");
  });

  it("does not repeat a recent word while others are left", async () => {
    await seed(2);
    const day1 = await getWordOfTheDay("UTC", now);
    const day2 = await getWordOfTheDay("UTC", new Date("2026-11-02T12:00:00Z"));
    assert.notEqual(day2.today?.front, day1.today?.front);
  });

  it("takes one answer a day and updates the record", async () => {
    await seed(3);
    const data = await getWordOfTheDay("UTC", now);

    const first = await answerWordOfTheDay(data.today?.day, "knew", "UTC", now);
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.record.knew, 1);
    assert.equal(first.ok && first.record.streak, 1);

    const second = await answerWordOfTheDay(data.today?.day, "missed", "UTC", now);
    assert.equal(second.ok, false);

    const after = await getWordOfTheDay("UTC", now);
    assert.equal(after.today?.result, "knew");
  });

  it("refuses bad input and days long gone", async () => {
    await seed(3);
    await getWordOfTheDay("UTC", new Date("2026-10-20T12:00:00Z"));
    assert.equal((await answerWordOfTheDay("2026-10-20", "knew", "UTC", now)).ok, false);
    assert.equal((await answerWordOfTheDay("yesterday", "knew", "UTC", now)).ok, false);
    assert.equal((await answerWordOfTheDay("2026-11-01", "maybe", "UTC", now)).ok, false);
  });

  it("keeps the word on the history after its card is deleted", async () => {
    await seed(3);
    const data = await getWordOfTheDay("UTC", new Date("2026-10-31T12:00:00Z"));
    await Card.deleteMany({});
    const next = await getWordOfTheDay("UTC", now);
    assert.equal(next.today, null);
    assert.equal(next.history[0]?.front, data.today?.front);
  });
});
