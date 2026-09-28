/**
 * Integration tests for the shared card-insert path and the HTTP API that sits
 * on top of it. The route handlers are called directly with a `Request`, which
 * exercises the real parsing, auth and status codes without a running server.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { POST as postCards } from "@/app/api/decks/[deck]/cards/route";
import { POST as postDeck } from "@/app/api/decks/route";
import { addCardsToDeck, extractCardList } from "@/lib/cards";
import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, ReviewLog } from "@/lib/db/models";

let mongo: MongoMemoryServer;

const API_KEY = "test-key-12345";

before(
  async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    process.env.MONGODB_DB = "flashcards_api_test";
    process.env.FLASHCARDS_API_KEY = API_KEY;
    await connectToDatabase();
  },
  { timeout: 300_000 },
);

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([Card.deleteMany({}), Deck.deleteMany({}), ReviewLog.deleteMany({})]);
});

/** A request shaped the way Postman would send it. */
function jsonRequest(body: unknown, key: string | null = API_KEY): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-api-key"] = key;

  return new Request("http://localhost:3000/api/decks/x/cards", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Route handlers take their params as a promise. */
function context(deck: string) {
  return { params: Promise.resolve({ deck }) };
}

async function seedDeck(name = "API deck"): Promise<string> {
  const deck = await Deck.create({ name });
  return String(deck._id);
}

describe("addCardsToDeck", () => {
  it("inserts valid cards", async () => {
    const deckId = await seedDeck();
    const result = await addCardsToDeck(deckId, [
      { front: "hola", back: "hello" },
      { front: "gracias", back: "thank you" },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.added, 2);
    assert.equal(await Card.countDocuments({}), 2);
  });

  it("accepts question and answer as aliases for front and back", async () => {
    const deckId = await seedDeck();
    const result = await addCardsToDeck(deckId, [
      { question: "hola", answer: "hello" },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.added, 1);
    const [card] = await Card.find({});
    assert.equal(card.front, "hola");
    assert.equal(card.back, "hello");
  });

  it("finds the deck by name as well as by id", async () => {
    await seedDeck("Spanish");
    const result = await addCardsToDeck("Spanish", [{ front: "a", back: "b" }]);

    assert.equal(result.ok, true);
    assert.equal(result.added, 1);
  });

  it("reports a missing deck rather than throwing", async () => {
    const result = await addCardsToDeck("no such deck", [{ front: "a", back: "b" }]);
    assert.deepEqual(result, { ok: false, reason: "deck-not-found" });
  });

  it("inserts the good cards and reports the bad ones", async () => {
    const deckId = await seedDeck();
    const result = await addCardsToDeck(deckId, [
      { front: "good", back: "card" },
      { front: "", back: "empty front" },
      { front: "no back", back: "   " },
      "not an object",
      { front: 42, back: "wrong type" },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.added, 1, "the one valid card still goes in");
    assert.equal(result.rejected.length, 4);
    assert.deepEqual(
      result.rejected.map((entry) => entry.index),
      [1, 2, 3, 4],
      "rejections point at the position in the submitted list",
    );
  });

  it("skips fronts the deck already has", async () => {
    const deckId = await seedDeck();
    await addCardsToDeck(deckId, [{ front: "hola", back: "hello" }]);
    const again = await addCardsToDeck(deckId, [
      { front: "HOLA", back: "hello again" },
      { front: "nuevo", back: "new" },
    ]);

    assert.equal(again.ok, true);
    assert.equal(again.added, 1);
    assert.equal(again.duplicatesInDeck, 1);
    assert.equal(await Card.countDocuments({}), 2);
  });

  it("counts fronts repeated inside one batch", async () => {
    const deckId = await seedDeck();
    const result = await addCardsToDeck(deckId, [
      { front: "same", back: "one" },
      { front: "same", back: "two" },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.added, 1);
    assert.equal(result.duplicatesInBatch, 1);
  });

  it("trims whitespace around both fields", async () => {
    const deckId = await seedDeck();
    await addCardsToDeck(deckId, [{ front: "  hola  ", back: "  hello  " }]);

    const [card] = await Card.find({});
    assert.equal(card.front, "hola");
    assert.equal(card.back, "hello");
  });

  it("rejects fields that are absurdly long", async () => {
    const deckId = await seedDeck();
    const result = await addCardsToDeck(deckId, [
      { front: "x".repeat(2001), back: "ok" },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.added, 0);
    assert.match(result.rejected[0].reason, /2000 characters/);
  });

  it("gives new cards a fresh scheduling state", async () => {
    const deckId = await seedDeck();
    await addCardsToDeck(deckId, [{ front: "hola", back: "hello" }]);

    const [card] = await Card.find({});
    assert.equal(card.state, "new");
    assert.equal(card.reps, 0);
    assert.equal(card.ease, 2.5);
  });
});

describe("extractCardList", () => {
  it("accepts a bare array", () => {
    assert.deepEqual(extractCardList([{ front: "a" }]), [{ front: "a" }]);
  });

  it("accepts an object wrapping a cards array", () => {
    assert.deepEqual(extractCardList({ cards: [{ front: "a" }] }), [{ front: "a" }]);
  });

  it("rejects anything else", () => {
    assert.equal(extractCardList({ notCards: [] }), null);
    assert.equal(extractCardList("nope"), null);
    assert.equal(extractCardList(null), null);
  });
});

describe("POST /api/decks/[deck]/cards", () => {
  it("creates cards and reports what happened", async () => {
    const deckId = await seedDeck();
    const response = await postCards(
      jsonRequest({
        cards: [
          { front: "hola", back: "hello" },
          { front: "gracias", back: "thank you" },
        ],
      }),
      context(deckId),
    );

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.added, 2);
    assert.equal(body.cards.length, 2);
    assert.equal(body.deck.id, deckId);
  });

  it("takes a bare array too", async () => {
    const deckId = await seedDeck();
    const response = await postCards(
      jsonRequest([{ front: "hola", back: "hello" }]),
      context(deckId),
    );

    assert.equal(response.status, 201);
    assert.equal((await response.json()).added, 1);
  });

  it("addresses a deck by name", async () => {
    await seedDeck("Spanish basics");
    const response = await postCards(
      jsonRequest([{ front: "hola", back: "hello" }]),
      context("Spanish basics"),
    );

    assert.equal(response.status, 201);
  });

  it("answers 200, not 201, when the batch adds nothing new", async () => {
    const deckId = await seedDeck();
    await postCards(jsonRequest([{ front: "hola", back: "hello" }]), context(deckId));

    const repeat = await postCards(
      jsonRequest([{ front: "hola", back: "hello" }]),
      context(deckId),
    );

    assert.equal(repeat.status, 200);
    const body = await repeat.json();
    assert.equal(body.added, 0);
    assert.equal(body.skipped.alreadyInDeck, 1);
  });

  it("refuses a request with no key", async () => {
    const deckId = await seedDeck();
    const response = await postCards(
      jsonRequest([{ front: "a", back: "b" }], null),
      context(deckId),
    );

    assert.equal(response.status, 401);
    assert.equal(await Card.countDocuments({}), 0, "nothing was written");
  });

  it("refuses a request with the wrong key", async () => {
    const deckId = await seedDeck();
    const response = await postCards(
      jsonRequest([{ front: "a", back: "b" }], "wrong-key-1234"),
      context(deckId),
    );

    assert.equal(response.status, 401);
  });

  it("fails closed when the server has no key configured", async () => {
    const deckId = await seedDeck();
    delete process.env.FLASHCARDS_API_KEY;
    try {
      const response = await postCards(
        jsonRequest([{ front: "a", back: "b" }]),
        context(deckId),
      );
      assert.equal(response.status, 503);
      assert.equal(await Card.countDocuments({}), 0);
    } finally {
      process.env.FLASHCARDS_API_KEY = API_KEY;
    }
  });

  it("404s on an unknown deck", async () => {
    const response = await postCards(
      jsonRequest([{ front: "a", back: "b" }]),
      context("does not exist"),
    );
    assert.equal(response.status, 404);
  });

  it("400s on malformed JSON", async () => {
    const deckId = await seedDeck();
    const response = await postCards(jsonRequest("{ not json"), context(deckId));
    assert.equal(response.status, 400);
  });

  it("400s when the body has no card list", async () => {
    const deckId = await seedDeck();
    const response = await postCards(jsonRequest({ nope: true }), context(deckId));
    assert.equal(response.status, 400);
  });

  it("400s on an empty batch", async () => {
    const deckId = await seedDeck();
    const response = await postCards(jsonRequest([]), context(deckId));
    assert.equal(response.status, 400);
  });
});

describe("POST /api/decks", () => {
  it("creates a deck", async () => {
    const response = await postDeck(
      jsonRequest({ name: "From Postman" }),
    );

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.deck.name, "From Postman");
    assert.ok(body.deck.id, "the new deck's id comes back for posting cards to");
  });

  it("409s on a duplicate name, and hands back the existing id", async () => {
    const deckId = await seedDeck("Taken");
    const response = await postDeck(jsonRequest({ name: "Taken" }));

    assert.equal(response.status, 409);
    assert.equal((await response.json()).deckId, deckId);
  });

  it("400s without a name", async () => {
    assert.equal((await postDeck(jsonRequest({}))).status, 400);
  });

  it("refuses a request with no key", async () => {
    assert.equal((await postDeck(jsonRequest({ name: "x" }, null))).status, 401);
  });
});
