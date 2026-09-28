import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck } from "@/lib/db/models";

/** Long enough for a paragraph-sized answer, short enough to catch a bad paste. */
const MAX_FIELD_LENGTH = 2000;

export interface CardInput {
  front: string;
  back: string;
}

export interface RejectedCard {
  /** Position in the submitted list, so the caller can point at the bad one. */
  index: number;
  reason: string;
}

export interface AddCardsResult {
  added: number;
  cards: Array<{ id: string; front: string; back: string }>;
  /** Fronts the deck already had. Re-sending the same batch is harmless. */
  duplicatesInDeck: number;
  /** Fronts repeated inside this one batch. */
  duplicatesInBatch: number;
  rejected: RejectedCard[];
}

export type AddCardsOutcome =
  | { ok: false; reason: "deck-not-found" }
  | ({ ok: true; deck: { id: string; name: string } } & AddCardsResult);

/**
 * Accept one submitted entry in whatever shape it arrived in.
 *
 * `question`/`answer` are accepted alongside `front`/`back` because that is
 * what people type when hand-writing JSON, and rejecting it would be pedantry.
 */
function normalizeCard(value: unknown, index: number): CardInput | RejectedCard {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { index, reason: "expected an object with front and back" };
  }

  const record = value as Record<string, unknown>;
  const rawFront = record.front ?? record.question;
  const rawBack = record.back ?? record.answer;

  if (typeof rawFront !== "string" || typeof rawBack !== "string") {
    return { index, reason: "front and back must both be strings" };
  }

  const front = rawFront.trim();
  const back = rawBack.trim();

  if (front === "" || back === "") {
    return { index, reason: "front and back must not be empty" };
  }
  if (front.length > MAX_FIELD_LENGTH || back.length > MAX_FIELD_LENGTH) {
    return { index, reason: `front and back must be under ${MAX_FIELD_LENGTH} characters` };
  }

  return { front, back };
}

function isRejection(value: CardInput | RejectedCard): value is RejectedCard {
  return "reason" in value;
}

/**
 * Resolve a deck by its id, or by its exact name when the value is not an
 * ObjectId. Naming a deck lets the HTTP API be driven without first looking up
 * an id, which is the difference between one Postman request and two.
 */
async function findDeck(idOrName: string) {
  if (mongoose.Types.ObjectId.isValid(idOrName)) {
    const byId = await Deck.findById(idOrName).lean();
    if (byId) return byId;
  }
  return Deck.findOne({ name: idOrName.trim() }).lean();
}

/**
 * Add cards to a deck, from any source.
 *
 * The manual form, the pasted-text import and the HTTP API all funnel through
 * here, so validation, de-duplication and the shape of the result are the same
 * whichever door the cards came in by.
 */
export async function addCardsToDeck(
  deckIdOrName: string,
  values: unknown[],
): Promise<AddCardsOutcome> {
  await connectToDatabase();

  const deck = await findDeck(deckIdOrName);
  if (!deck) return { ok: false, reason: "deck-not-found" };

  const rejected: RejectedCard[] = [];
  const candidates: CardInput[] = [];
  const seen = new Set<string>();
  let duplicatesInBatch = 0;

  values.forEach((value, index) => {
    const result = normalizeCard(value, index);
    if (isRejection(result)) {
      rejected.push(result);
      return;
    }

    const key = result.front.toLowerCase();
    if (seen.has(key)) {
      duplicatesInBatch += 1;
      return;
    }
    seen.add(key);
    candidates.push(result);
  });

  const existing = await Card.find({ deckId: deck._id }).select("front").lean();
  const existingFronts = new Set(existing.map((card) => card.front.toLowerCase()));
  const fresh = candidates.filter(
    (card) => !existingFronts.has(card.front.toLowerCase()),
  );

  const inserted =
    fresh.length > 0
      ? await Card.insertMany(
          fresh.map((card) => ({
            deckId: deck._id,
            front: card.front,
            back: card.back,
          })),
        )
      : [];

  return {
    ok: true,
    deck: { id: String(deck._id), name: deck.name },
    added: inserted.length,
    cards: inserted.map((card) => ({
      id: String(card._id),
      front: card.front,
      back: card.back,
    })),
    duplicatesInDeck: candidates.length - fresh.length,
    duplicatesInBatch,
    rejected,
  };
}

/**
 * Pull the card list out of a request body, accepting the shapes a person
 * actually sends: a bare array, or an object wrapping one under `cards`.
 */
export function extractCardList(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;

  if (typeof body === "object" && body !== null) {
    const { cards } = body as Record<string, unknown>;
    if (Array.isArray(cards)) return cards;
  }

  return null;
}
