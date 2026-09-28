import { revalidatePath } from "next/cache";

import { checkApiKey } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db/connect";
import { Deck } from "@/lib/db/models";
import { listDecks } from "@/lib/decks";

/**
 * GET /api/decks
 *
 * Lists decks with their ids and current counts. Mostly here so an id can be
 * copied out before posting cards to it.
 */
export async function GET(request: Request) {
  const failure = checkApiKey(request);
  if (failure) {
    return Response.json({ error: failure.message }, { status: failure.status });
  }

  try {
    return Response.json({ decks: await listDecks() });
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 500 });
  }
}

/**
 * POST /api/decks
 *
 * Body: { "name": "...", "description"?: "..." }
 */
export async function POST(request: Request) {
  const failure = checkApiKey(request);
  if (failure) {
    return Response.json({ error: failure.message }, { status: failure.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (name === "") {
    return Response.json({ error: "A deck name is required." }, { status: 400 });
  }

  try {
    await connectToDatabase();

    // Named decks are the handle the cards API uses, so they have to stay
    // unique or a later post could land in either one.
    const clash = await Deck.findOne({ name }).lean();
    if (clash) {
      return Response.json(
        { error: `A deck named "${name}" already exists.`, deckId: String(clash._id) },
        { status: 409 },
      );
    }

    const deck = await Deck.create({
      name,
      description:
        typeof fields.description === "string" ? fields.description.trim() : "",
    });

    revalidatePath("/");

    return Response.json(
      { deck: { id: String(deck._id), name: deck.name } },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: describe(error) }, { status: 500 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error.";
}
