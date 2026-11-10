/**
 * Word of the Day: the record from answered days, then picking and answering
 * against an in-process MongoDB.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, DailyWord, Deck, ReviewLog } from "@/lib/db/models";
import { getPlayerStats } from "@/lib/stats";
import {
  cannotRestore,
  nextMonthStart,
  RESTORE_COST,
  restoreCards,
  RESTORES_PER_MONTH,
  wordRecord,
} from "@/lib/word-of-the-day";
import {
  answerWordOfTheDay,
  getWordOfTheDay,
  restoreWordDay,
  restoreXpSpent,
} from "@/lib/word-of-the-day-db";

/** Noon UTC on `day`. */
const at = (day: string) => new Date(`${day}T12:00:00Z`);

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

  it("offers missed days for restoring, but not today or days before the first word", () => {
    const record = wordRecord(
      [
        { day: "2026-11-01", result: "knew" },
        { day: "2026-11-02", result: null },
        { day: "2026-11-04", result: "knew", restored: true },
        { day: "2026-11-05", result: null, restored: true },
      ],
      "2026-11-06",
      8,
    );
    const offered = (day: string) => record.calendar.find((entry) => entry.day === day)?.canRestore;
    assert.equal(offered("2026-10-31"), false); // before the first word
    assert.equal(offered("2026-11-01"), false); // answered
    assert.equal(offered("2026-11-02"), true); // picked, never answered
    assert.equal(offered("2026-11-03"), true); // app not opened at all
    assert.equal(offered("2026-11-04"), false); // already restored
    assert.equal(offered("2026-11-05"), false); // restored, answer still to come
    assert.equal(offered("2026-11-06"), false); // today
    assert.equal(record.calendar.find((entry) => entry.day === "2026-11-04")?.restored, true);
  });

  it("counts a restored day that was known towards the streak", () => {
    const record = wordRecord(
      [
        { day: "2026-11-03", result: "knew" },
        { day: "2026-11-04", result: "knew", restored: true },
        { day: "2026-11-05", result: "knew" },
      ],
      "2026-11-06",
    );
    assert.equal(record.streak, 3);
    assert.equal(record.knew, 3);
  });
});

describe("restore cards", () => {
  it("come three a month and renew on the first", () => {
    assert.deepEqual(restoreCards(1, "2026-11-10"), {
      left: 2,
      perMonth: RESTORES_PER_MONTH,
      cost: RESTORE_COST,
      renewsOn: "2026-12-01",
    });
    assert.equal(restoreCards(5, "2026-11-10").left, 0);
    assert.equal(nextMonthStart("2026-12-31"), "2027-01-01");
  });

  it("need a card left and enough XP", () => {
    assert.equal(cannotRestore(0, RESTORE_COST), null);
    assert.match(cannotRestore(RESTORES_PER_MONTH, 99_999) ?? "", /used all 3/);
    assert.match(cannotRestore(0, 999) ?? "", /costs 1,000 XP\. You have 999/);
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
    await Promise.all([
      Card.deleteMany({}),
      Deck.deleteMany({}),
      DailyWord.deleteMany({}),
      ReviewLog.deleteMany({}),
    ]);
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

  /** Words picked on 1 to 3 Nov; 1 and 2 known, 3 left unanswered, 4 never opened. */
  async function missedTwo() {
    await seed(6);
    for (const day of ["2026-11-01", "2026-11-02", "2026-11-03"]) {
      const data = await getWordOfTheDay("UTC", at(day));
      if (day !== "2026-11-03") await answerWordOfTheDay(data.today?.day, "knew", "UTC", at(day));
    }
  }

  it("restores a missed day for XP, then takes a late answer", async () => {
    await missedTwo();
    const today = at("2026-11-05");

    const late = await answerWordOfTheDay("2026-11-03", "knew", "UTC", today);
    assert.equal(late.ok, false, "a missed day needs a restore card first");

    const restored = await restoreWordDay("2026-11-03", 2500, "UTC", today);
    assert.ok(restored.ok);
    assert.equal(restored.word.day, "2026-11-03");
    assert.equal(restored.word.restored, true);
    assert.equal(restored.word.result, null);
    assert.equal(restored.restores.left, RESTORES_PER_MONTH - 1);
    assert.equal(await restoreXpSpent(), RESTORE_COST);

    // Asking again before answering hands the same word back, for nothing.
    const again = await restoreWordDay("2026-11-03", 2500, "UTC", today);
    assert.ok(again.ok);
    assert.equal(again.word.front, restored.word.front);
    assert.equal(await restoreXpSpent(), RESTORE_COST);

    const answered = await answerWordOfTheDay("2026-11-03", "knew", "UTC", today);
    assert.ok(answered.ok);
    const day3 = answered.record.calendar.find((entry) => entry.day === "2026-11-03");
    assert.equal(day3?.result, "knew");
    assert.equal(day3?.restored, true);

    const data = await getWordOfTheDay("UTC", today);
    assert.equal(data.history.find((word) => word.day === "2026-11-03")?.restored, true);
    assert.equal(data.history.find((word) => word.day === "2026-11-03")?.restoredOn, "2026-11-05");
    assert.equal(data.history.find((word) => word.day === "2026-11-02")?.restored, false);
  });

  it("picks a word for a day the app was never opened, and mends the streak", async () => {
    await missedTwo();
    const today = at("2026-11-05");
    assert.equal((await getWordOfTheDay("UTC", today)).record.streak, 0);

    for (const day of ["2026-11-03", "2026-11-04"]) {
      const restored = await restoreWordDay(day, 5000, "UTC", today);
      assert.ok(restored.ok, day);
      assert.ok(restored.word.front.startsWith("learned-"));
      await answerWordOfTheDay(day, "knew", "UTC", today);
    }
    assert.equal((await getWordOfTheDay("UTC", today)).record.streak, 4);
  });

  it("refuses today, days before the first word, answered days, and too little XP", async () => {
    await missedTwo();
    const today = at("2026-11-05");
    await getWordOfTheDay("UTC", today);

    assert.match(failure(await restoreWordDay("2026-11-05", 5000, "UTC", today)), /not over/);
    assert.match(failure(await restoreWordDay("2026-10-31", 5000, "UTC", today)), /too far back/);
    assert.match(failure(await restoreWordDay("2026-11-02", 5000, "UTC", today)), /already answered/);
    assert.match(failure(await restoreWordDay("2026-11-03", 999, "UTC", today)), /costs 1,000 XP/);
    assert.equal(await restoreXpSpent(), 0);
  });

  it("gives three cards a month, and fresh ones the next month", async () => {
    await seed(10);
    await getWordOfTheDay("UTC", at("2026-11-01"));
    const nov = at("2026-11-08");
    for (const day of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
      assert.ok((await restoreWordDay(day, 99_999, "UTC", nov)).ok, day);
    }
    assert.match(failure(await restoreWordDay("2026-11-05", 99_999, "UTC", nov)), /used all 3/);

    // On 1 Dec the calendar reaches back to 4 Nov, and the cards are back.
    const dec = at("2026-12-01");
    assert.match(failure(await restoreWordDay("2026-11-01", 99_999, "UTC", dec)), /too far back/);
    // A day paid for in November can still be answered: it hands its word back.
    assert.ok((await restoreWordDay("2026-11-03", 99_999, "UTC", dec)).ok);
    const fresh = await restoreWordDay("2026-11-05", 99_999, "UTC", dec);
    assert.ok(fresh.ok);
    assert.equal(fresh.restores.left, RESTORES_PER_MONTH - 1);
    assert.equal(fresh.restores.renewsOn, "2027-01-01");
  });

  it("takes the restore's XP off the XP to spend, not off the level", async () => {
    await missedTwo();
    const deck = await Deck.findOne().lean();
    const card = await Card.findOne().lean();
    const when = at("2026-11-04");
    await ReviewLog.insertMany(
      Array.from({ length: 25 }, () => ({
        cardId: card?._id,
        deckId: deck?._id,
        grade: "good",
        before: { state: "new", step: 0, intervalDays: 0, ease: 2.5, due: when, lapses: 0, reps: 0 },
        intervalDaysAfter: 1,
        easeAfter: 2.5,
        reviewedAt: when,
        xp: 100,
      })),
    );
    const today = at("2026-11-05");
    const before = await getPlayerStats("UTC", today);
    assert.equal(before.xpToSpend, 2500);

    assert.ok((await restoreWordDay("2026-11-03", before.xpToSpend, "UTC", today)).ok);
    const after = await getPlayerStats("UTC", today);
    assert.equal(after.xpToSpend, 1500);
    assert.equal(after.xp, 2500);
    assert.equal(after.level, before.level);
  });
});

function failure(outcome: { ok: true } | { ok: false; message: string }): string {
  assert.equal(outcome.ok, false);
  return outcome.ok ? "" : outcome.message;
}
