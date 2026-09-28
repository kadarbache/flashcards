import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteCard, deleteDeck } from "@/app/actions";
import { CardForm } from "@/components/card-form";
import { ImportForm } from "@/components/import-form";
import { SettingsForm } from "@/components/settings-form";
import { SetupNotice } from "@/components/setup-notice";
import { isFrameworkControlFlow } from "@/lib/next-errors";
import {
  getDeck,
  getNextCard,
  listCards,
  type CardSummary,
  type DeckSettings,
  type NextCardResult,
} from "@/lib/decks";

export default async function DeckPage({ params }: PageProps<"/decks/[id]">) {
  const { id } = await params;

  let data: {
    deck: DeckSettings;
    cards: CardSummary[];
    queue: NextCardResult;
  };

  try {
    const deck = await getDeck(id);
    if (!deck) notFound();
    const [cards, queue] = await Promise.all([listCards(id), getNextCard(id)]);
    data = { deck, cards, queue };
  } catch (error) {
    if (isFrameworkControlFlow(error)) throw error;
    return <SetupNotice error={error} />;
  }

  const { deck, cards, queue } = data;
  const { counts } = queue;
  const dueTotal = counts.newCards + counts.learning + counts.review;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{deck.name}</h1>
            {deck.description !== "" && (
              <p className="mt-1 text-sm text-ink-muted">{deck.description}</p>
            )}
            <p className="mt-2 text-xs text-ink-muted">
              <span className="font-semibold text-easy">{counts.newCards}</span> new,{" "}
              <span className="font-semibold text-again">{counts.learning}</span> learning,{" "}
              <span className="font-semibold text-good">{counts.review}</span> review
              {counts.scheduled > 0 && (
                <>
                  , <span className="font-semibold">{counts.scheduled}</span> scheduled
                </>
              )}
              &middot; {cards.length} cards
              {queue.reviewedToday > 0 && <> &middot; {queue.reviewedToday} answered today</>}
            </p>
          </div>

          {dueTotal > 0 ? (
            <Link
              href={`/decks/${deck.id}/review`}
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface"
            >
              Review {dueTotal}
            </Link>
          ) : (
            <span className="rounded-md border border-border-subtle px-4 py-2 text-sm text-ink-muted">
              Nothing due
            </span>
          )}
        </div>
      </section>

      <section className="space-y-4 border-t border-border-subtle pt-8">
        <h2 className="text-sm font-semibold tracking-tight">Add a card</h2>
        <CardForm deckId={deck.id} />
      </section>

      <section className="space-y-4 border-t border-border-subtle pt-8">
        <h2 className="text-sm font-semibold tracking-tight">
          Import many{" "}
          <span className="font-normal text-ink-muted">paste, or a file</span>
        </h2>
        <ImportForm deckId={deck.id} />
      </section>

      <section className="space-y-4 border-t border-border-subtle pt-8">
        <h2 className="text-sm font-semibold tracking-tight">Deck settings</h2>
        <SettingsForm deck={deck} />
      </section>

      <section className="space-y-4 border-t border-border-subtle pt-8">
        <h2 className="text-sm font-semibold tracking-tight">
          Cards <span className="font-normal text-ink-muted">({cards.length})</span>
        </h2>
        {cards.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No cards yet. Paste some above to get started.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
            {cards.map((card) => (
              <CardRow key={card.id} card={card} deckId={deck.id} />
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-border-subtle pt-8">
        <form action={deleteDeck}>
          <input type="hidden" name="deckId" value={deck.id} />
          <button
            type="submit"
            className="text-sm text-again underline-offset-4 hover:underline"
          >
            Delete this deck and its {cards.length} cards
          </button>
        </form>
      </section>
    </div>
  );
}

function CardRow({ card, deckId }: { card: CardSummary; deckId: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{card.front}</p>
        <p className="truncate text-ink-muted">{card.back}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-ink-muted">
        <span>{card.stateLabel}</span>
        <span title="current interval">{card.intervalLabel}</span>
        <span title="due">{card.dueLabel}</span>
        <span title="ease factor">{card.ease.toFixed(2)}</span>
        <form action={deleteCard}>
          <input type="hidden" name="cardId" value={card.id} />
          <input type="hidden" name="deckId" value={deckId} />
          <button type="submit" className="text-again hover:underline">
            delete
          </button>
        </form>
      </div>
    </li>
  );
}
