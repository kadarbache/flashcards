import Link from "next/link";

import { DeckForm } from "@/components/deck-form";
import { SetupNotice } from "@/components/setup-notice";
import { listDecks, type DeckSummary } from "@/lib/decks";

/**
 * The deck list is live data: due counts change as cards come due, with no
 * request touching this page. Without this the route is prerendered at build
 * time, which would freeze the counts -- and bake in the setup screen if the
 * database happened to be unreachable during the build.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  let decks: DeckSummary[];
  try {
    decks = await listDecks();
  } catch (error) {
    // Most likely no MONGODB_URI, a bad password, or an Atlas IP allow-list
    // miss. Say so instead of throwing a stack trace at the user.
    return <SetupNotice error={error} />;
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Decks</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {decks.length === 0
              ? "No decks yet. Create one below, then import some cards."
              : "Pick a deck to review, or open it to add and edit cards."}
          </p>
        </div>

        {decks.length > 0 && (
          <ul className="space-y-3">
            {decks.map((deck) => (
              <DeckRow key={deck.id} deck={deck} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 border-t border-border-subtle pt-8">
        <h2 className="text-sm font-semibold tracking-tight">New deck</h2>
        <DeckForm />
      </section>
    </div>
  );
}

function DeckRow({ deck }: { deck: DeckSummary }) {
  const dueTotal = deck.dueNew + deck.dueLearning + deck.dueReview;

  return (
    <li className="rounded-lg border border-border-subtle bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/decks/${deck.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {deck.name}
          </Link>
          {deck.description !== "" && (
            <p className="mt-0.5 truncate text-sm text-ink-muted">{deck.description}</p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <Count label="new" value={deck.dueNew} color="text-easy" />
            <Count label="learning" value={deck.dueLearning} color="text-again" />
            <Count label="review" value={deck.dueReview} color="text-good" />
            {deck.scheduled > 0 && (
              <Count label="scheduled" value={deck.scheduled} color="text-ink-muted" />
            )}
            <span>{deck.totalCards} total</span>
          </p>
        </div>

        {dueTotal > 0 ? (
          <Link
            href={`/decks/${deck.id}/review`}
            className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface"
          >
            Review {dueTotal}
          </Link>
        ) : (
          <span className="shrink-0 rounded-md border border-border-subtle px-4 py-2 text-sm text-ink-muted">
            Nothing due
          </span>
        )}
      </div>
    </li>
  );
}

function Count({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <span>
      <span className={`font-semibold ${value > 0 ? color : ""}`}>{value}</span> {label}
    </span>
  );
}
