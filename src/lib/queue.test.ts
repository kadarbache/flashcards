/**
 * Integration tests for the queue and the persistence around it, run against a
 * real MongoDB started in-process. The scheduler itself is covered by unit
 * tests in src/lib/srs; what is checked here is the part that only a database
 * can tell you: which card comes next, and what actually got written.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, ReviewLog } from "@/lib/db/models";
import { getNextCard, listCards, listDecks } from "@/lib/decks";
import { answerCard, undoLastAnswer } from "@/lib/review";

let mongo: MongoMemoryServer;

/** Downloading mongod on the first run takes a while. */
const STARTUP_TIMEOUT = 300_000;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "flashcards_test";
  await connectToDatabase();
}, { timeout: STARTUP_TIMEOUT });

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    Card.deleteMany({}),
    Deck.deleteMany({}),
    ReviewLog.deleteMany({}),
  ]);
});

async function seedDeck(
  cards: number,
  deckFields: Record<string, unknown> = {},
): Promise<string> {
  const deck = await Deck.create({ name: "Test deck", ...deckFields });
  await Card.insertMany(
    Array.from({ length: cards }, (_, index) => ({
      deckId: deck._id,
      front: `front ${index + 1}`,
      back: `back ${index + 1}`,
    })),
  );
  return String(deck._id);
}

describe("getNextCard", () => {
  it("returns a new card and counts it", async () => {
    const deckId = await seedDeck(3);
    const { card, counts } = await getNextCard(deckId, { shuffle: false });

    assert.ok(card, "expected a card");
    assert.equal(card.front, "front 1");
    assert.equal(counts.newCards, 3);
    assert.equal(counts.learning, 0);
    assert.equal(counts.review, 0);
  });

  it("labels the grading buttons for the card it returns", async () => {
    const deckId = await seedDeck(1);
    const { card } = await getNextCard(deckId);

    assert.deepEqual(card?.previews, {
      again: "1m",
      hard: "1m",
      good: "10m",
      easy: "4d",
    });
  });

  it("keeps offering new cards with no daily cap", async () => {
    const deckId = await seedDeck(5);

    const first = await getNextCard(deckId);
    assert.equal(first.counts.newCards, 5);

    // Answering with Easy graduates a card outright, so it leaves the new pile
    // without coming back in ten minutes.
    await answerCard(first.card!.id, "easy");
    const second = await getNextCard(deckId);
    assert.equal(second.counts.newCards, 4);
    assert.ok(second.card, "a fifth new card is still offered");

    await answerCard(second.card!.id, "easy");
    const third = await getNextCard(deckId);
    assert.equal(third.counts.newCards, 3);
    assert.ok(third.card, "and another, however many were answered today");
  });

  it("counts answers given today", async () => {
    const deckId = await seedDeck(2);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "good");

    const next = await getNextCard(deckId);
    assert.equal(next.reviewedToday, 1);
  });

  it("serves a learning card once its step comes due, ahead of new cards", async () => {
    const deckId = await seedDeck(2);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "good");

    // Pretend the 10-minute step has elapsed.
    await Card.findByIdAndUpdate(card!.id, { due: new Date(Date.now() - 60_000) });

    const next = await getNextCard(deckId);
    assert.equal(next.card?.id, card!.id, "the learning card jumps the queue");
    assert.equal(next.counts.learning, 1);
  });

  it("reports nothing due for a deck with no cards", async () => {
    const deckId = await seedDeck(0);
    const { card, counts, nextDueAtMs } = await getNextCard(deckId);

    assert.equal(card, null);
    assert.equal(counts.newCards, 0);
    assert.equal(nextDueAtMs, null);
  });

  it("returns an empty queue for an id that is not a deck", async () => {
    const { card } = await getNextCard("not-an-object-id");
    assert.equal(card, null);
  });
});

describe("answerCard", () => {
  it("advances a new card onto the learning ladder", async () => {
    const deckId = await seedDeck(1);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "good");

    const stored = await Card.findById(card!.id).lean();
    assert.equal(stored?.state, "learning");
    assert.equal(stored?.step, 1);
    assert.equal(stored?.reps, 1);
    assert.equal(stored?.intervalDays, 0);

    const minutesOut = (stored!.due.getTime() - Date.now()) / 60_000;
    assert.ok(minutesOut > 9 && minutesOut <= 10, `due in ${minutesOut}m`);
  });

  it("writes one history row per answer, with the state it came from", async () => {
    const deckId = await seedDeck(1);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "good", 4200);

    const logs = await ReviewLog.find({ cardId: card!.id }).lean();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].grade, "good");
    assert.equal(logs[0].before?.state, "new");
    assert.equal(logs[0].before?.reps, 0);
    assert.equal(logs[0].elapsedMs, 4200);
  });

  it("uses the deck's own learning steps", async () => {
    const deckId = await seedDeck(1, { learningStepsMinutes: [5] });
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "good");

    // A single-step ladder means one Good graduates the card.
    const stored = await Card.findById(card!.id).lean();
    assert.equal(stored?.state, "review");
    assert.equal(stored?.intervalDays, 1);
  });

  it("drops ease and counts a lapse when a review card gets Again", async () => {
    await seedDeck(1);
    const [only] = await Card.find({});
    await Card.findByIdAndUpdate(only._id, {
      state: "review",
      intervalDays: 30,
      ease: 2.5,
      due: new Date(Date.now() - 1000),
    });

    await answerCard(String(only._id), "again");

    const stored = await Card.findById(only._id).lean();
    assert.equal(stored?.state, "relearning");
    assert.equal(stored?.lapses, 1);
    assert.equal(stored?.ease, 2.3);
    assert.equal(stored?.intervalDays, 1, "default config resets the interval");
  });

  it("grows the interval on a Good answer in review", async () => {
    await seedDeck(1);
    const [only] = await Card.find({});
    await Card.findByIdAndUpdate(only._id, {
      state: "review",
      intervalDays: 10,
      ease: 2.5,
      due: new Date(Date.now() - 1000),
    });

    await answerCard(String(only._id), "good");

    const stored = await Card.findById(only._id).lean();
    // 10 * 2.5, give or take the 5% fuzz.
    assert.ok(
      stored!.intervalDays >= 24 && stored!.intervalDays <= 27,
      `interval was ${stored!.intervalDays}`,
    );
  });

  it("rejects an unknown card", async () => {
    await assert.rejects(
      () => answerCard("507f1f77bcf86cd799439011", "good"),
      /Unknown card/,
    );
  });

  it("rejects a grade that is not one of the four buttons", async () => {
    const deckId = await seedDeck(1);
    const { card } = await getNextCard(deckId);
    await assert.rejects(
      // @ts-expect-error - deliberately wrong, this is the guard being tested
      () => answerCard(card!.id, "brilliant"),
      /Unknown grade/,
    );
  });
});

describe("listDecks", () => {
  it("reports per-deck counts", async () => {
    const deckId = await seedDeck(4, { name: "Alpha" });
    const decks = await listDecks();

    assert.equal(decks.length, 1);
    assert.equal(decks[0].name, "Alpha");
    assert.equal(decks[0].totalCards, 4);
    assert.equal(decks[0].dueNew, 4, "every new card counts as due");
    assert.equal(decks[0].scheduled, 0);
    assert.equal(decks[0].dueReview, 0);
    assert.equal(decks[0].id, deckId, "the ObjectId is handed over as a string");

  });

  it("counts a due review card", async () => {
    await seedDeck(2);
    const [first] = await Card.find({});
    await Card.findByIdAndUpdate(first._id, {
      state: "review",
      intervalDays: 5,
      due: new Date(Date.now() - 1000),
    });

    const [deck] = await listDecks();
    assert.equal(deck.dueReview, 1);
    assert.equal(deck.dueNew, 1);
  });
});

describe("listCards", () => {
  it("describes each card's scheduling state for the deck page", async () => {
    const deckId = await seedDeck(1);
    const [card] = await listCards(deckId);

    assert.equal(card.state, "new");
    assert.equal(card.stateLabel, "New");
    assert.equal(card.intervalLabel, "-");
    assert.equal(card.dueLabel, "-");
  });

  it("shows a due review card as due now", async () => {
    const deckId = await seedDeck(1);
    const [only] = await Card.find({});
    await Card.findByIdAndUpdate(only._id, {
      state: "review",
      intervalDays: 12,
      due: new Date(Date.now() - 1000),
    });

    const [card] = await listCards(deckId);
    assert.equal(card.stateLabel, "Review");
    assert.equal(card.intervalLabel, "12d");
    assert.equal(card.dueLabel, "now");
  });
});

describe("undoLastAnswer", () => {
  it("puts the card back exactly as it was", async () => {
    const deckId = await seedDeck(1);
    const [only] = await Card.find({});
    await Card.findByIdAndUpdate(only._id, {
      state: "review",
      step: 0,
      intervalDays: 30,
      ease: 2.5,
      due: new Date("2026-02-01T00:00:00.000Z"),
      lapses: 1,
      reps: 9,
    });
    const before = await Card.findById(only._id).lean();

    await answerCard(String(only._id), "again");
    const lapsed = await Card.findById(only._id).lean();
    assert.equal(lapsed?.state, "relearning", "precondition: the answer landed");

    const restored = await undoLastAnswer(deckId);
    assert.equal(restored, String(only._id));

    const after = await Card.findById(only._id).lean();
    assert.equal(after?.state, before?.state);
    assert.equal(after?.intervalDays, before?.intervalDays);
    assert.equal(after?.ease, before?.ease, "the ease drop is undone too");
    assert.equal(after?.lapses, before?.lapses, "and so is the lapse count");
    assert.equal(after?.reps, before?.reps);
    assert.equal(after?.due.getTime(), before?.due.getTime());
  });

  it("removes the history row and puts the card back in the new pile", async () => {
    const deckId = await seedDeck(3);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "good");

    const after = await getNextCard(deckId);
    assert.equal(after.counts.newCards, 2, "the answered card left the new pile");

    await undoLastAnswer(deckId);
    const restored = await getNextCard(deckId);
    assert.equal(restored.counts.newCards, 3);
    assert.equal(await ReviewLog.countDocuments({}), 0);
  });

  it("serves the restored card next", async () => {
    const deckId = await seedDeck(2);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "easy"); // pushed 4 days out

    const restored = await undoLastAnswer(deckId);
    const next = await getNextCard(deckId, { prefer: restored! });
    assert.equal(next.card?.id, card!.id);
  });

  it("does nothing when there is no history", async () => {
    const deckId = await seedDeck(1);
    assert.equal(await undoLastAnswer(deckId), null);
  });
});

describe("skipping", () => {
  it("leaves skipped cards out of the draw", async () => {
    const deckId = await seedDeck(3);
    const first = await getNextCard(deckId);

    const second = await getNextCard(deckId, { exclude: [first.card!.id] });
    assert.notEqual(second.card?.id, first.card?.id);
  });

  it("still counts skipped cards as due, because they are", async () => {
    const deckId = await seedDeck(3);
    const first = await getNextCard(deckId);

    const second = await getNextCard(deckId, { exclude: [first.card!.id] });
    assert.equal(second.counts.newCards, 3);
  });

  it("runs out of cards once everything is skipped", async () => {
    const deckId = await seedDeck(2);
    const all = await Card.find({});
    const result = await getNextCard(deckId, {
      exclude: all.map((card) => String(card._id)),
    });
    assert.equal(result.card, null);
  });

  it("ignores ids that are not valid object ids", async () => {
    const deckId = await seedDeck(1);
    const result = await getNextCard(deckId, { exclude: ["nonsense", ""] });
    assert.ok(result.card, "a junk exclusion should not empty the queue");
  });
});

describe("partial write safety", () => {
  it("leaves the card untouched when the history row cannot be written", async () => {
    const deckId = await seedDeck(1);
    const { card } = await getNextCard(deckId);
    const before = await Card.findById(card!.id).lean();

    const create = ReviewLog.create.bind(ReviewLog);
    ReviewLog.create = (() => Promise.reject(new Error("log write failed"))) as
      typeof ReviewLog.create;

    try {
      await assert.rejects(() => answerCard(card!.id, "good"), /log write failed/);
    } finally {
      ReviewLog.create = create;
    }

    const after = await Card.findById(card!.id).lean();
    assert.equal(after?.state, before?.state, "state must not have moved");
    assert.equal(after?.reps, before?.reps, "the rep must not have been counted");
    assert.equal(after?.due.getTime(), before?.due.getTime());
  });
});

describe("the counts add up", () => {
  /** new + learning + review + scheduled must always equal the card total. */
  function assertReconciles(deck: {
    dueNew: number;
    dueLearning: number;
    dueReview: number;
    scheduled: number;
    totalCards: number;
  }) {
    const sum = deck.dueNew + deck.dueLearning + deck.dueReview + deck.scheduled;
    assert.equal(
      sum,
      deck.totalCards,
      `buckets summed to ${sum} but the deck holds ${deck.totalCards}`,
    );
  }

  it("counts a card whose learning step is still minutes away", async () => {
    // The exact case that looked like cards had vanished: answered, on the
    // ladder, next step ten minutes out, so due for nothing right now.
    const deckId = await seedDeck(6);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "good");

    const [deck] = await listDecks();
    assert.equal(deck.dueNew, 5);
    assert.equal(deck.dueLearning, 1, "the card is still on the ladder");
    assert.equal(deck.dueReview, 0);
    assert.equal(deck.scheduled, 0);
    assertReconciles(deck);
  });

  it("counts a graduated card that is days away as scheduled", async () => {
    const deckId = await seedDeck(3);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "easy"); // graduates straight out to 4 days

    const [deck] = await listDecks();
    assert.equal(deck.dueNew, 2);
    assert.equal(deck.dueLearning, 0);
    assert.equal(deck.dueReview, 0, "not due for days");
    assert.equal(deck.scheduled, 1);
    assertReconciles(deck);
  });

  it("reconciles with cards spread across every bucket", async () => {
    await seedDeck(5);
    const cards = await Card.find({}).sort({ createdAt: 1 });

    await Card.findByIdAndUpdate(cards[0]._id, {
      state: "learning",
      due: new Date(Date.now() + 5 * 60_000),
    });
    await Card.findByIdAndUpdate(cards[1]._id, {
      state: "review",
      intervalDays: 10,
      due: new Date(Date.now() - 60_000),
    });
    await Card.findByIdAndUpdate(cards[2]._id, {
      state: "review",
      intervalDays: 10,
      due: new Date(Date.now() + 5 * 86_400_000),
    });
    await Card.findByIdAndUpdate(cards[3]._id, {
      state: "relearning",
      due: new Date(Date.now() - 60_000),
    });

    const [deck] = await listDecks();
    assert.equal(deck.dueNew, 1);
    assert.equal(deck.dueLearning, 2, "one learning, one relearning");
    assert.equal(deck.dueReview, 1);
    assert.equal(deck.scheduled, 1);
    assertReconciles(deck);
  });

  it("matches between the deck list and the review queue", async () => {
    const deckId = await seedDeck(4);
    const { card } = await getNextCard(deckId);
    await answerCard(card!.id, "good");

    const [deck] = await listDecks();
    const { counts } = await getNextCard(deckId);

    assert.equal(counts.newCards, deck.dueNew);
    assert.equal(counts.learning, deck.dueLearning);
    assert.equal(counts.review, deck.dueReview);
    assert.equal(counts.scheduled, deck.scheduled);
  });
});

describe("shuffling", () => {
  it("draws new cards in a different order across sessions", async () => {
    const deckId = await seedDeck(12);

    const seen = new Set<string>();
    for (let draw = 0; draw < 40; draw++) {
      const { card } = await getNextCard(deckId);
      seen.add(card!.front);
    }

    // Nothing was answered, so an unshuffled queue would return the same card
    // all 40 times.
    assert.ok(seen.size > 1, `only ever drew ${[...seen].join(", ")}`);
  });

  it("reaches every card in the pile, not just a favoured few", async () => {
    const deckId = await seedDeck(6);

    const seen = new Set<string>();
    for (let draw = 0; draw < 200; draw++) {
      const { card } = await getNextCard(deckId);
      seen.add(card!.front);
    }

    assert.equal(seen.size, 6, "every card should come up given enough draws");
  });

  it("shuffles due review cards too", async () => {
    await seedDeck(8);
    await Card.updateMany(
      {},
      { state: "review", intervalDays: 5, due: new Date(Date.now() - 60_000) },
    );
    const [deck] = await listDecks();

    const seen = new Set<string>();
    for (let draw = 0; draw < 40; draw++) {
      const { card } = await getNextCard(deck.id);
      seen.add(card!.front);
    }

    assert.ok(seen.size > 1, "reviews should not always start with the same card");
  });

  it("keeps the ladder in due order, shuffle or not", async () => {
    const deckId = await seedDeck(3);
    const cards = await Card.find({}).sort({ createdAt: 1 });

    // Three learning cards, all overdue by different amounts.
    await Card.findByIdAndUpdate(cards[0]._id, {
      state: "learning",
      due: new Date(Date.now() - 60_000),
    });
    await Card.findByIdAndUpdate(cards[1]._id, {
      state: "learning",
      due: new Date(Date.now() - 600_000),
    });
    await Card.findByIdAndUpdate(cards[2]._id, {
      state: "learning",
      due: new Date(Date.now() - 300_000),
    });

    // The most overdue one wins every time: a one-minute step that waits its
    // turn behind others has quietly become a ten-minute step.
    for (let draw = 0; draw < 12; draw++) {
      const { card } = await getNextCard(deckId);
      assert.equal(card?.id, String(cards[1]._id));
    }
  });

  it("still honours an explicit order when asked", async () => {
    const deckId = await seedDeck(5);
    for (let draw = 0; draw < 5; draw++) {
      const { card } = await getNextCard(deckId, { shuffle: false });
      assert.equal(card?.front, "front 1");
    }
  });

  it("does not draw a skipped card even when shuffling", async () => {
    const deckId = await seedDeck(3);
    const first = await getNextCard(deckId);

    for (let draw = 0; draw < 30; draw++) {
      const { card } = await getNextCard(deckId, { exclude: [first.card!.id] });
      assert.notEqual(card?.id, first.card!.id);
    }
  });
});
