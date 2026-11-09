import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck } from "@/lib/db/models";
import type { FinderCard } from "@/lib/word-finder";

/** Every card the word finder reads, oldest first, so their numbers stay put between questions. */
export async function loadFinderCards(): Promise<FinderCard[]> {
  await connectToDatabase();
  const [decks, cards] = await Promise.all([
    Deck.find().select({ name: 1 }).lean(),
    Card.find().sort({ createdAt: 1, _id: 1 }).select({ deckId: 1, front: 1, back: 1, example: 1 }).lean(),
  ]);

  const names = new Map(decks.map((deck) => [String(deck._id), deck.name]));
  return cards.map((card) => ({
    id: String(card._id),
    deckId: String(card.deckId),
    deckName: names.get(String(card.deckId)) ?? "",
    front: card.front,
    back: card.back,
    example: card.example ?? "",
  }));
}

/** How many cards there are to search, for the page's empty state. */
export async function countFinderCards(): Promise<number> {
  await connectToDatabase();
  return Card.estimatedDocumentCount();
}
