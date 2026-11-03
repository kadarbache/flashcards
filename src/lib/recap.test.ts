/**
 * The weekly recap: the counting on its own, then whole weeks read back from
 * an in-process MongoDB.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Boss, Card, DailyWord, Deck, Profile, ReviewLog, Transcript } from "@/lib/db/models";
import { bestCombo, medalsWon, summarizeWeek, weekRange, type RecapAnswer, type WeekInput } from "@/lib/recap";
import { defaultRecapWeek, getRecap } from "@/lib/recap-db";

function answer(overrides: Partial<RecapAnswer> = {}): RecapAnswer {
  return {
    cardId: "c1",
    deckId: "d1",
    grade: "good",
    day: "2026-11-02",
    at: 0,
    xp: 10,
    elapsedMs: null,
    before: { state: "review", intervalDays: 3 },
    intervalDaysAfter: 8,
    ...overrides,
  };
}

describe("weekRange", () => {
  it("names the month once inside a month, and both across two", () => {
    assert.equal(weekRange("2026-11-02"), "2 – 8 Nov");
    assert.equal(weekRange("2026-12-28"), "28 Dec – 3 Jan");
  });
});

describe("bestCombo", () => {
  it("finds the longest run with no pause over 20 seconds", () => {
    assert.equal(bestCombo([]), 0);
    assert.equal(bestCombo([0, 5_000, 10_000, 60_000, 65_000]), 3);
    assert.equal(bestCombo([65_000, 0, 10_000, 5_000]), 3);
  });
});

describe("medalsWon", () => {
  it("counts graduations as bronze and interval crossings as silver and gold, once per card", () => {
    const medals = medalsWon([
      answer({ cardId: "a", before: { state: "learning", intervalDays: 0 }, intervalDaysAfter: 1 }),
      answer({ cardId: "a", before: { state: "learning", intervalDays: 0 }, intervalDaysAfter: 1 }),
      answer({ cardId: "b", before: { state: "review", intervalDays: 15 }, intervalDaysAfter: 36 }),
      answer({ cardId: "c", before: { state: "review", intervalDays: 60 }, intervalDaysAfter: 150 }),
      answer({ cardId: "d", grade: "again", before: { state: "learning", intervalDays: 0 }, intervalDaysAfter: 1 }),
      answer({ cardId: "e", before: { state: "learning", intervalDays: 0 }, intervalDaysAfter: 0 }),
    ]);
    assert.deepEqual(medals, { learned: 1, silver: 1, gold: 1 });
  });
});

describe("summarizeWeek", () => {
  const base: WeekInput = {
    monday: "2026-11-02",
    today: "2026-11-04",
    goal: 2,
    answers: [],
    previousAnswers: 0,
    added: 0,
    videos: 0,
    words: [],
    bosses: [],
    toughest: null,
    streak: 0,
    deckNames: new Map([["d1", "Vocab"], ["d2", "Phrases"]]),
  };

  it("adds up the week, the days on goal and the busiest deck", () => {
    const recap = summarizeWeek({
      ...base,
      answers: [
        answer({ day: "2026-11-02", at: 0, xp: 10, elapsedMs: 4_000 }),
        answer({ day: "2026-11-02", at: 5_000, xp: 15, elapsedMs: 600_000 }),
        answer({ day: "2026-11-03", at: 90_000_000, xp: 10, deckId: "d2" }),
      ],
      bosses: [{ front: "ubiquitous", xp: 150 }],
      words: [{ result: "knew" }, { result: "missed" }, { result: null }],
      previousAnswers: 2,
    });
    assert.equal(recap.answers, 3);
    assert.equal(recap.xp, 185);
    assert.equal(recap.minutes, 1); // a card left open counts a minute at most
    assert.equal(recap.daysMet, 1);
    assert.deepEqual(
      recap.days.map((day) => [day.letter, day.count, day.met, day.isToday, day.future]),
      [
        ["M", 2, true, false, false],
        ["T", 1, false, false, false],
        ["W", 0, false, true, false],
        ["T", 0, false, false, true],
        ["F", 0, false, false, true],
        ["S", 0, false, false, true],
        ["S", 0, false, false, true],
      ],
    );
    assert.deepEqual(recap.topDeck, { name: "Vocab", answers: 2 });
    assert.deepEqual(recap.word, { knew: 1, answered: 2 });
    assert.deepEqual(recap.bosses, ["ubiquitous"]);
    assert.equal(recap.change, 50);
    assert.equal(recap.current, true);
    assert.equal(recap.bestCombo, 2);
  });

  it("gives no change when the week before was empty", () => {
    assert.equal(summarizeWeek({ ...base, answers: [answer()] }).change, null);
  });
});

describe("recaps in the database", () => {
  let mongo: MongoMemoryServer;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB = "flashcards_recap_test";
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
      DailyWord.deleteMany({}),
      Boss.deleteMany({}),
      Profile.deleteMany({}),
      Transcript.deleteMany({}),
    ]);
  });

  async function logAt(iso: string, overrides: Record<string, unknown> = {}) {
    const deck = (await Deck.findOne()) ?? (await Deck.create({ name: "Vocab" }));
    const card =
      (await Card.findOne({ front: "word" })) ??
      (await Card.create({ deckId: deck._id, front: "word", back: "meaning" }));
    await ReviewLog.create({
      cardId: card._id,
      deckId: deck._id,
      grade: "good",
      before: {
        state: "review",
        step: 0,
        intervalDays: 3,
        ease: 2.5,
        due: new Date(iso),
        lapses: 0,
        reps: 3,
      },
      intervalDaysAfter: 8,
      easeAfter: 2.5,
      reviewedAt: new Date(iso),
      xp: 10,
      ...overrides,
    });
  }

  it("shows last week until Sunday, and this week on Sunday", () => {
    assert.equal(defaultRecapWeek("2026-11-03"), "2026-10-26"); // a Tuesday
    assert.equal(defaultRecapWeek("2026-11-08"), "2026-11-02"); // a Sunday
  });

  it("cuts the week on the player's calendar", async () => {
    // Sunday 23:30 UTC is already Monday in Nairobi.
    await logAt("2026-11-01T23:30:00Z");
    await logAt("2026-11-03T10:00:00Z");

    const utc = await getRecap("UTC", "2026-11-02", new Date("2026-11-04T12:00:00Z"));
    assert.equal(utc.recap.answers, 1);

    const nairobi = await getRecap("Africa/Nairobi", "2026-11-02", new Date("2026-11-04T12:00:00Z"));
    assert.equal(nairobi.recap.answers, 2);
    assert.equal(nairobi.recap.days[0].count, 1);
  });

  it("compares with the week before and steps between weeks", async () => {
    await logAt("2026-10-27T10:00:00Z");
    await logAt("2026-11-03T10:00:00Z");
    await logAt("2026-11-04T10:00:00Z");

    const page = await getRecap("UTC", "2026-11-04", new Date("2026-11-10T12:00:00Z"));
    assert.equal(page.recap.monday, "2026-11-02");
    assert.equal(page.recap.change, 100);
    assert.equal(page.previous, "2026-10-26");
    assert.equal(page.next, "2026-11-09");

    const first = await getRecap("UTC", "2026-10-27", new Date("2026-11-10T12:00:00Z"));
    assert.equal(first.previous, null);
  });

  it("holds a week still going against the same stretch of the week before", async () => {
    await logAt("2026-10-26T10:00:00Z"); // last Monday
    await logAt("2026-10-27T09:00:00Z"); // last Tuesday, before this time of day
    await logAt("2026-10-27T15:00:00Z"); // last Tuesday, after it
    await logAt("2026-10-30T10:00:00Z"); // last Friday
    await logAt("2026-11-02T10:00:00Z");
    await logAt("2026-11-03T10:00:00Z");

    const { recap } = await getRecap("UTC", undefined, new Date("2026-11-03T12:00:00Z"));
    assert.equal(recap.monday, "2026-10-26"); // a Tuesday shows last week...
    assert.equal(recap.change, null); // ...and the week before it had nothing

    const now = await getRecap("UTC", "2026-11-03", new Date("2026-11-03T12:00:00Z"));
    assert.equal(now.recap.current, true);
    assert.equal(now.recap.change, 0); // 2 against the 2 by Tuesday noon, not all 4
  });

  it("never goes past the current week", async () => {
    const page = await getRecap("UTC", "2027-05-05", new Date("2026-11-04T12:00:00Z"));
    assert.equal(page.recap.monday, "2026-11-02");
    assert.equal(page.next, null);
    assert.equal(page.recap.current, true);
  });

  it("names the hardest word answered right, and counts beaten bosses' XP", async () => {
    const deck = await Deck.create({ name: "Vocab" });
    const card = await Card.create({ deckId: deck._id, front: "ubiquitous", back: "everywhere", lapses: 4 });
    await logAt("2026-11-03T10:00:00Z", {
      cardId: card._id,
      before: { state: "relearning", step: 0, intervalDays: 1, ease: 1.3, due: new Date(), lapses: 4, reps: 9 },
    });
    await Boss.create({
      startDay: "2026-11-01",
      endDay: "2026-11-07",
      cardId: card._id,
      deckId: deck._id,
      front: "ubiquitous",
      back: "everywhere",
      lapses: 4,
      defeatedOn: "2026-11-03",
      xp: 150,
    });

    const { recap } = await getRecap("UTC", "2026-11-02", new Date("2026-11-08T12:00:00Z"));
    assert.deepEqual(recap.toughest, { front: "ubiquitous", lapses: 4 });
    assert.deepEqual(recap.bosses, ["ubiquitous"]);
    assert.equal(recap.xp, 160);
  });

  it("gives the streak at the end of a past week", async () => {
    await Profile.create({ key: "owner", dailyGoal: 5 });
    for (const day of ["2026-11-06", "2026-11-07", "2026-11-08"]) {
      for (let i = 0; i < 5; i += 1) await logAt(`${day}T10:0${i}:00Z`);
    }
    const { recap } = await getRecap("UTC", "2026-11-02", new Date("2026-11-20T12:00:00Z"));
    assert.equal(recap.streak, 3);
    assert.equal(recap.daysMet, 3);
  });
});
