import { revalidatePath } from "next/cache";

import { checkApiKey } from "@/lib/api-auth";
import { addCardsToDeck, extractCardList } from "@/lib/cards";
import { listCards } from "@/lib/decks";

/**
 * POST /api/decks/{deckIdOrName}/cards
 *
 * Bulk-create cards in one deck. `{deck}` is either the deck's id or its exact
 * name, so a batch can be posted without looking an id up first.
 *
 * Body is either a bare array or an object wrapping one:
 *
 *   [{ "front": "hola", "back": "hello" }]
 *   { "cards": [{ "question": "hola", "answer": "hello" }] }
 *
 * Valid cards are inserted even when others in the batch are not; the response
 * says exactly what happened to each one. Cards whose front already exists in
 * the deck are skipped, so re-posting a batch does not duplicate it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/decks/[deck]/cards">) {
  const failure = checkApiKey(request);
  if (failure) {
    return Response.json({ error: failure.message }, { status: failure.status });
  }

  const { deck } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const cards = extractCardList(body);
  if (cards === null) {
    return Response.json(
      {
        error:
          'Send an array of cards, or an object with a "cards" array. Each card needs a front and a back.',
      },
      { status: 400 },
    );
  }
  if (cards.length === 0) {
    return Response.json({ error: "No cards in the request." }, { status: 400 });
  }

  try {
    const result = await addCardsToDeck(decodeURIComponent(deck), cards);

    if (!result.ok) {
      return Response.json(
        { error: `No deck found with id or name "${decodeURIComponent(deck)}".` },
        { status: 404 },
      );
    }

    revalidatePath("/");
    revalidatePath(`/decks/${result.deck.id}`);

    // 201 only when something was actually created; a batch that adds nothing
    // is a successful no-op, not a creation.
    return Response.json(
      {
        deck: result.deck,
        added: result.added,
        skipped: {
          alreadyInDeck: result.duplicatesInDeck,
          repeatedInBatch: result.duplicatesInBatch,
          invalid: result.rejected,
        },
        cards: result.cards,
      },
      { status: result.added > 0 ? 201 : 200 },
    );
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 500 });
  }
}

/** GET /api/decks/{deckIdOrName}/cards - read back what is in the deck. */
export async function GET(request: Request, ctx: RouteContext<"/api/decks/[deck]/cards">) {
  const failure = checkApiKey(request);
  if (failure) {
    return Response.json({ error: failure.message }, { status: failure.status });
  }

  const { deck } = await ctx.params;

  try {
    // An empty batch resolves the deck without writing anything.
    const resolved = await addCardsToDeck(decodeURIComponent(deck), []);
    if (!resolved.ok) {
      return Response.json(
        { error: `No deck found with id or name "${decodeURIComponent(deck)}".` },
        { status: 404 },
      );
    }

    return Response.json({
      deck: resolved.deck,
      cards: await listCards(resolved.deck.id, 1000),
    });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 500 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error.";
}
