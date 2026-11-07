import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteCard, deleteDeck } from "@/app/actions";
import { CardForm } from "@/components/card-form";
import { DeleteButton } from "@/components/confirm-delete";
import { ArrowIcon, BoltIcon, CheckIcon, PlayIcon, SwapIcon, TrophyIcon } from "@/components/icons";
import { ImportForm } from "@/components/import-form";
import { SettingsForm } from "@/components/settings-form";
import { SetupNotice } from "@/components/setup-notice";
import { iconButton, panel, primaryButton, secondaryButton } from "@/components/ui";
import { MIN_BLITZ_CARDS } from "@/lib/blitz";
import {
  getDeck,
  getNextCard,
  listCards,
  type CardSummary,
  type DeckSettings,
  type NextCardResult,
} from "@/lib/decks";
import { isFrameworkControlFlow } from "@/lib/next-errors";

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
    <div className="space-y-6 sm:space-y-8">
      <section className="anim-rise space-y-5">
        <div className="flex items-start gap-3">
          <Link href="/" className={iconButton} aria-label="Back to home">
            <ArrowIcon direction="left" className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-extrabold tracking-tight break-words sm:text-4xl">
              {deck.name}
            </h1>
            {deck.description !== "" && <p className="mt-1 text-ink-muted">{deck.description}</p>}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Count label="New" value={counts.newCards} color="text-easy" />
          <Count label="Learning" value={counts.learning} color="text-again" />
          <Count label="Review" value={counts.review} color="text-good" />
          <Count label="Waiting" value={counts.scheduled} color="text-ink" />
        </dl>

        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {dueTotal > 0 ? (
            <Link href={`/decks/${deck.id}/review`} className={`${primaryButton} min-h-14 text-lg`}>
              <PlayIcon className="h-5 w-5" />
              Play {dueTotal} {dueTotal === 1 ? "card" : "cards"}
            </Link>
          ) : (
            <span className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-good/15 px-5 font-extrabold text-good">
              <CheckIcon className="h-5 w-5" />
              {cards.length === 0 ? "Add cards to start" : "All caught up"}
            </span>
          )}
          {cards.length > 0 && (
            <Link href={`/decks/${deck.id}/practice`} className={`${secondaryButton} min-h-14`}>
              <SwapIcon className="h-5 w-5 text-easy" />
              Practice
            </Link>
          )}
          {cards.length >= MIN_BLITZ_CARDS && (
            <Link href={`/decks/${deck.id}/blitz`} className={`${secondaryButton} min-h-14`}>
              <BoltIcon className="h-5 w-5 text-gold" />
              Blitz
              {deck.blitzBest > 0 && (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-muted">
                  <TrophyIcon className="h-4 w-4" />
                  {deck.blitzBest.toLocaleString("en-US")}
                </span>
              )}
            </Link>
          )}
        </div>
        <p className="text-sm text-ink-muted">
          {cards.length} {cards.length === 1 ? "card" : "cards"}
          {queue.reviewedToday > 0 && <> · {queue.reviewedToday} answered today</>}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <section className={`${panel} space-y-4`}>
          <h2 className="text-lg font-extrabold">Add a card</h2>
          <CardForm deckId={deck.id} />
        </section>

        <section className={`${panel} space-y-4`}>
          <h2 className="text-lg font-extrabold">
            Import many <span className="text-sm font-semibold text-ink-muted">paste, or a file</span>
          </h2>
          <ImportForm deckId={deck.id} />
        </section>
      </div>

      <section className={`${panel} space-y-4`}>
        <h2 className="text-lg font-extrabold">
          Cards <span className="text-ink-muted">({cards.length})</span>
        </h2>
        {cards.length === 0 ? (
          <p className="text-ink-muted">No cards yet. Add or paste some above to get started.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {cards.map((card) => (
              <CardRow key={card.id} card={card} deckId={deck.id} />
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr] lg:gap-6">
        <section className={`${panel} space-y-4`}>
          <h2 className="text-lg font-extrabold">Deck settings</h2>
          <SettingsForm deck={deck} />
        </section>

        <section className="space-y-3 rounded-3xl border border-again/30 bg-again/5 p-5 sm:p-6">
          <h2 className="text-lg font-extrabold text-again">Delete deck</h2>
          <p className="text-sm text-ink-muted">
            Removes the deck, its {cards.length} cards and their history. This cannot be undone.
          </p>
          <DeleteButton
            action={deleteDeck}
            fields={{ deckId: deck.id }}
            title="Delete this deck?"
            name={deck.name}
            detail={`Its ${cards.length} ${cards.length === 1 ? "card goes" : "cards go"} with it, and all their history. This cannot be undone.`}
            className="inline-flex min-h-11 items-center rounded-2xl border border-again/50 px-4 text-sm font-bold text-again transition hover:bg-again/15"
          >
            Delete this deck
          </DeleteButton>
        </section>
      </div>
    </div>
  );
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl bg-surface-raised px-4 py-3">
      <dd className={`text-2xl leading-none font-extrabold tabular-nums ${color}`}>{value}</dd>
      <dt className="mt-1 text-xs font-semibold text-ink-muted">{label}</dt>
    </div>
  );
}

function CardRow({ card, deckId }: { card: CardSummary; deckId: string }) {
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-2xl bg-surface-high px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-bold break-words">{card.front}</p>
        <p className="truncate text-ink-muted">{card.back}</p>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted">
          <span className="font-semibold text-ink">{card.stateLabel}</span>
          {card.state !== "new" && (
            <>
              <span title="Current interval">every {card.intervalLabel}</span>
              <span title="Due">due {card.dueLabel}</span>
            </>
          )}
          <span title="Ease factor">ease {card.ease.toFixed(2)}</span>
        </p>
      </div>
      <DeleteButton
        action={deleteCard}
        fields={{ cardId: card.id, deckId }}
        title="Delete this card?"
        name={card.front}
        detail="Its review history goes with it. This cannot be undone."
        className="rounded-full px-2.5 py-1 text-xs font-bold text-again transition hover:bg-again/15"
        ariaLabel={`Delete ${card.front}`}
      >
        Delete
      </DeleteButton>
    </li>
  );
}
