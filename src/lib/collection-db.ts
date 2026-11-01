import { countTiers, type TierCounts } from "@/lib/collection";
import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck } from "@/lib/db/models";
import type { CardState } from "@/lib/srs/types";

/** One sticker in the album. The rank is worked out from these on the page. */
export interface CollectionWord {
  id: string;
  front: string;
  back: string;
  state: CardState;
  intervalDays: number;
  lapses: number;
}

export interface CollectionDeck {
  id: string;
  name: string;
  words: CollectionWord[];
  counts: TierCounts;
}

export interface Collection {
  counts: TierCounts;
  decks: CollectionDeck[];
}

/** Every card, grouped by deck, in alphabetical order so each word keeps its slot. */
export async function getCollection(): Promise<Collection> {
  await connectToDatabase();
  const [decks, cards] = await Promise.all([
    Deck.find().sort({ name: 1 }).select({ name: 1 }).lean(),
    Card.find()
      .select({ deckId: 1, front: 1, back: 1, state: 1, intervalDays: 1, lapses: 1 })
      .lean(),
  ]);

  const byDeck = new Map<string, CollectionWord[]>();
  for (const card of cards) {
    const key = String(card.deckId);
    const list = byDeck.get(key) ?? [];
    list.push({
      id: String(card._id),
      front: card.front,
      back: card.back,
      state: card.state as CardState,
      intervalDays: card.intervalDays,
      lapses: card.lapses,
    });
    byDeck.set(key, list);
  }

  const groups = decks
    .map((deck) => {
      const words = (byDeck.get(String(deck._id)) ?? []).sort((a, b) =>
        a.front.localeCompare(b.front, "en", { sensitivity: "base" }),
      );
      return { id: String(deck._id), name: deck.name, words, counts: countTiers(words) };
    })
    .filter((deck) => deck.words.length > 0);

  return { counts: countTiers(cards), decks: groups };
}

/** Just the medal counts, for the home screen. */
export async function getCollectionCounts(): Promise<TierCounts> {
  await connectToDatabase();
  const cards = await Card.find().select({ state: 1, intervalDays: 1 }).lean();
  return countTiers(cards);
}
