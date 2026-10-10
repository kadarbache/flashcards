"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Arrow, Flashcard, GhostButton } from "@/components/flashcard";
import type { PracticeCard } from "@/lib/decks";
import { shuffled } from "@/lib/shuffle";

/**
 * A run through the whole deck with nothing at stake.
 *
 * No Server Action is imported here, on purpose. The cards arrive as a prop
 * and every move after that -- flip, next, back, go again -- is local state,
 * so there is no path from this screen to a card's schedule or to the review
 * history. That is the whole difference from `ReviewSession`.
 */
export function PracticeSession({
  deckId,
  deckName,
  cards,
}: {
  deckId: string;
  deckName: string;
  cards: PracticeCard[];
}) {
  const [order, setOrder] = useState(cards);
  /** Where the run has got to. Equal to `order.length` once it is over. */
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const card = order[index] ?? null;

  const goTo = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(next, order.length)));
      setFlipped(false);
      setMenuOpen(false);
    },
    [order.length],
  );

  const restart = useCallback(() => {
    setOrder(shuffled(order));
    setIndex(0);
    setFlipped(false);
    setMenuOpen(false);
  }, [order]);

  /** The main button, and space: reveal the answer, then move on. */
  const advance = useCallback(() => {
    if (flipped) goTo(index + 1);
    else setFlipped(true);
  }, [flipped, goTo, index]);

  // Arrows step through the deck, and left still works from the end screen to
  // get back in.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
        return;
      }
      if (!card) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        advance();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, card, goTo, index]);

  if (order.length === 0) {
    return (
      <EndCard title="No cards to practice" detail="Add some to this deck first.">
        <DeckLink deckId={deckId} deckName={deckName} />
      </EndCard>
    );
  }

  if (!card) {
    const count = order.length;
    return (
      <EndCard
        title="That is the whole deck"
        detail={`${count} ${count === 1 ? "card" : "cards"}, none of them graded. Your schedule is where you left it.`}
      >
        <DeckLink deckId={deckId} deckName={deckName} />
        <button
          type="button"
          onClick={restart}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-surface"
        >
          Shuffle and go again
        </button>
      </EndCard>
    );
  }

  const isLast = index === order.length - 1;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6">
      {/*
       * Keyed by card, so a new one mounts face up instead of turning back
       * over. Both faces change text at once, so an animated turn back would
       * carry the next card's answer round with it for the first half.
       */}
      <Flashcard
        key={card.id}
        front={card.front}
        back={card.back}
        flipped={flipped}
        onFlip={setFlipped}
        label="Practice"
        position={index + 1}
        total={order.length}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((was) => !was)}
        deckId={deckId}
        deckName={deckName}
      />

      <div className="w-full space-y-3">
        <button
          type="button"
          onClick={advance}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl border border-border-subtle bg-surface-raised text-sm font-medium transition active:scale-[0.99]"
        >
          {flipped ? (isLast ? "Finish" : "Next card") : "Show answer"}
          <kbd className="hidden rounded border border-border-subtle px-1.5 py-0.5 text-[0.6875rem] font-normal text-ink-muted sm:inline">
            space
          </kbd>
        </button>

        <div className="flex items-center gap-2 text-xs">
          <GhostButton
            label="Previous card"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
          >
            <Arrow direction="left" />
            Back
          </GhostButton>

          <p className="min-w-0 flex-1 text-center text-ink-muted">
            Practice run. Nothing is graded.
          </p>

          <GhostButton label="Next card" onClick={() => goTo(index + 1)}>
            Next
            <Arrow direction="right" />
          </GhostButton>
        </div>
      </div>
    </div>
  );
}

/** The panel shown instead of a card: an empty deck, or the end of a run. */
function EndCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md space-y-5 text-center">
      <div className="rounded-3xl border border-border-subtle bg-surface-raised px-6 py-14">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{detail}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  );
}

function DeckLink({ deckId, deckName }: { deckId: string; deckName: string }) {
  return (
    <Link
      href={`/decks/${deckId}`}
      className="rounded-full border border-border-subtle px-4 py-2 text-sm"
    >
      {deckName}
    </Link>
  );
}
