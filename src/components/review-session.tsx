"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  deleteCardAndContinue,
  gradeCard,
  refreshQueue,
  undoLastGrade,
} from "@/app/actions";
import { Arrow, Flashcard, GhostButton } from "@/components/flashcard";
import type { NextCardResult } from "@/lib/decks";
import type { Grade } from "@/lib/srs/types";

/**
 * Button colour and keyboard digit for each grade, in display order.
 *
 * The tones are written out in full rather than built from the grade name --
 * Tailwind scans source text for complete class names, so `text-${grade}` would
 * compile to nothing.
 */
const BUTTONS: Array<{ grade: Grade; label: string; tone: string; key: string }> = [
  {
    grade: "again",
    label: "Again",
    tone: "text-again border-again/40 bg-again/10 hover:bg-again/20",
    key: "1",
  },
  {
    grade: "hard",
    label: "Hard",
    tone: "text-hard border-hard/40 bg-hard/10 hover:bg-hard/20",
    key: "2",
  },
  {
    grade: "good",
    label: "Good",
    tone: "text-good border-good/40 bg-good/10 hover:bg-good/20",
    key: "3",
  },
  {
    grade: "easy",
    label: "Easy",
    tone: "text-easy border-easy/40 bg-easy/10 hover:bg-easy/20",
    key: "4",
  },
];

export function ReviewSession({
  deckId,
  deckName,
  initial,
}: {
  deckId: string;
  deckName: string;
  initial: NextCardResult;
}) {
  const [queue, setQueue] = useState(initial);
  const [flipped, setFlipped] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Cards put aside for this session only; the server filters them out. */
  const [skipped, setSkipped] = useState<string[]>([]);
  /** When the current card went on screen, for the answer-time log. */
  const shownAt = useRef<number | null>(null);

  const { card, counts, reviewedToday } = queue;
  const remaining = counts.newCards + counts.learning + counts.review;

  const apply = useCallback((next: NextCardResult) => {
    setQueue(next);
    setFlipped(false);
    setMenuOpen(false);
  }, []);

  // Restart the answer-time clock whenever a different card goes up.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [card?.id]);

  /** Wraps every server round trip: one in flight at a time, errors surfaced. */
  const run = useCallback(
    async (work: () => Promise<NextCardResult>) => {
      if (pending) return;
      setPending(true);
      setError(null);
      try {
        apply(await work());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
      } finally {
        setPending(false);
      }
    },
    [apply, pending],
  );

  const grade = useCallback(
    (value: Grade) => {
      if (!card) return;
      const elapsedMs = shownAt.current === null ? null : Date.now() - shownAt.current;
      return run(() => gradeCard(card.id, value, elapsedMs, { exclude: skipped }));
    },
    [card, run, skipped],
  );

  const undo = useCallback(
    () => run(() => undoLastGrade(deckId, { exclude: skipped })),
    [deckId, run, skipped],
  );

  const skip = useCallback(() => {
    if (!card) return;
    const next = [...skipped, card.id];
    setSkipped(next);
    return run(() => refreshQueue(deckId, { exclude: next }));
  }, [card, deckId, run, skipped]);

  const unskip = useCallback(() => {
    setSkipped([]);
    return run(() => refreshQueue(deckId, { exclude: [] }));
  }, [deckId, run]);

  const removeCard = useCallback(() => {
    if (!card) return;
    return run(() => deleteCardAndContinue(card.id, deckId, { exclude: skipped }));
  }, [card, deckId, run, skipped]);

  // Space flips the card; 1-4 grade it once it is face up; arrows move around.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void undo();
        return;
      }
      if (event.key === "ArrowRight" && card) {
        event.preventDefault();
        void skip();
        return;
      }
      if (!card) return;

      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setFlipped((was) => !was);
        return;
      }

      if (flipped) {
        const button = BUTTONS.find((entry) => entry.key === event.key);
        if (button) {
          event.preventDefault();
          void grade(button.grade);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [card, flipped, grade, skip, undo]);

  if (!card) {
    return (
      <QueueEmpty
        deckId={deckId}
        deckName={deckName}
        queue={queue}
        skippedCount={skipped.length}
        onRefresh={apply}
        onUnskip={unskip}
        onUndo={undo}
        canUndo={reviewedToday > 0}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6">
      <Flashcard
        front={card.front}
        back={card.back}
        flipped={flipped}
        onFlip={setFlipped}
        dimmed={pending}
        label={card.stateLabel}
        position={reviewedToday + 1}
        total={reviewedToday + remaining}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((was) => !was)}
        onDelete={removeCard}
        deckId={deckId}
        deckName={deckName}
      />

      {/*
       * Four equal columns rather than a flex row of pills. A grid track can
       * shrink below its content, so the row cannot force the page sideways at
       * any width -- the old row had a 432px floor (two 56px circles, four
       * 68px pills, six gaps) against a ~343px phone, which is what pushed the
       * buttons off screen. Undo and skip moved out of this line for the same
       * reason: they are not answers, so they do not belong in the answer row.
       */}
      <div className="w-full space-y-3">
        {flipped ? (
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {BUTTONS.map((button) => (
              <button
                key={button.grade}
                type="button"
                onClick={() => void grade(button.grade)}
                disabled={pending}
                title={`${button.label} (${button.key})`}
                className={`flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-1 transition active:scale-[0.97] disabled:opacity-40 ${button.tone}`}
              >
                <span className="text-[0.8125rem] leading-none font-semibold">
                  {button.label}
                </span>
                <span className="text-[0.6875rem] leading-none tabular-nums opacity-70">
                  {card.previews[button.grade]}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFlipped(true)}
            disabled={pending}
            className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl border border-border-subtle bg-surface-raised text-sm font-medium transition active:scale-[0.99] disabled:opacity-40"
          >
            Show answer
            <kbd className="hidden rounded border border-border-subtle px-1.5 py-0.5 text-[0.6875rem] font-normal text-ink-muted sm:inline">
              space
            </kbd>
          </button>
        )}

        <div className="flex items-center gap-2 text-xs">
          <GhostButton
            label="Undo last answer"
            onClick={() => void undo()}
            disabled={pending || reviewedToday === 0}
          >
            <Arrow direction="left" />
            Undo
          </GhostButton>

          <p className="min-w-0 flex-1 text-center text-ink-muted">
            <span className="text-easy">{counts.newCards} new</span> &middot;{" "}
            <span className="text-again">{counts.learning} learning</span> &middot;{" "}
            <span className="text-good">{counts.review} review</span>
            {counts.scheduled > 0 && <> &middot; {counts.scheduled} scheduled</>}
            {skipped.length > 0 && (
              <>
                {" "}
                &middot;{" "}
                <button
                  type="button"
                  onClick={() => void unskip()}
                  className="underline underline-offset-4"
                >
                  {skipped.length} skipped
                </button>
              </>
            )}
          </p>

          <GhostButton
            label="Skip this card for now"
            onClick={() => void skip()}
            disabled={pending}
          >
            Skip
            <Arrow direction="right" />
          </GhostButton>
        </div>
      </div>

      {error !== null && (
        <p className="rounded-md border border-again/40 px-3 py-2 text-center text-sm text-again">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Nothing is due right now. If a learning card is a minute away, count down to
 * it and pull it in when it lands rather than telling the user they are done.
 */
function QueueEmpty({
  deckId,
  deckName,
  queue,
  skippedCount,
  onRefresh,
  onUnskip,
  onUndo,
  canUndo,
}: {
  deckId: string;
  deckName: string;
  queue: NextCardResult;
  skippedCount: number;
  onRefresh: (next: NextCardResult) => void;
  onUnskip: () => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const { nextDueAtMs, reviewedToday } = queue;
  const [loading, setLoading] = useState(false);
  const now = useNow();

  const remainingMs = nextDueAtMs !== null && now !== null ? nextDueAtMs - now : null;

  const pull = useCallback(async () => {
    setLoading(true);
    try {
      onRefresh(await refreshQueue(deckId));
    } finally {
      setLoading(false);
    }
  }, [deckId, onRefresh]);

  // Wake up exactly when the soonest card comes due and pull it in. Firing from
  // the timer rather than from a rendered "is it ready yet" flag keeps this to
  // one scheduled call instead of one per tick.
  useEffect(() => {
    if (nextDueAtMs === null) return;
    const timer = setTimeout(() => void pull(), Math.max(0, nextDueAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [nextDueAtMs, pull]);

  return (
    <div className="mx-auto max-w-md space-y-5 text-center">
      <div className="rounded-3xl border border-border-subtle bg-surface-raised px-6 py-14">
        <h1 className="text-xl font-semibold tracking-tight">
          {skippedCount > 0 ? "Only skipped cards left" : "Nothing due"}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {reviewedToday > 0
            ? `${reviewedToday} ${reviewedToday === 1 ? "answer" : "answers"} today.`
            : "This deck has nothing waiting."}
        </p>
        {remainingMs !== null && remainingMs > 0 && (
          <p className="mt-4 text-sm text-ink-muted">
            Next card in{" "}
            <span className="font-semibold text-ink">{countdown(remainingMs)}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href={`/decks/${deckId}`}
          className="rounded-full border border-border-subtle px-4 py-2 text-sm"
        >
          {deckName}
        </Link>
        {skippedCount > 0 && (
          <button
            type="button"
            onClick={onUnskip}
            className="rounded-full border border-border-subtle px-4 py-2 text-sm"
          >
            Bring back {skippedCount} skipped
          </button>
        )}
        {canUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="rounded-full border border-border-subtle px-4 py-2 text-sm"
          >
            Undo last answer
          </button>
        )}
        <button
          type="button"
          onClick={() => void pull()}
          disabled={loading}
          className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
        >
          {loading ? "Checking..." : "Check again"}
        </button>
      </div>
    </div>
  );
}

/**
 * The current time, ticking once a second, or null on the server and during
 * hydration -- rendering a clock server-side would only mismatch. Subscribing
 * through `useSyncExternalStore` keeps the ticking out of an effect body.
 */
function useNow(intervalMs = 1000): number | null {
  // Null until subscribed, which matches the server snapshot and keeps the
  // clock out of the render pass.
  const cached = useRef<number | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      cached.current = Date.now();
      const timer = setInterval(() => {
        cached.current = Date.now();
        onStoreChange();
      }, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );

  return useSyncExternalStore(
    subscribe,
    () => cached.current,
    () => null,
  );
}

function countdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.round(hours / 24)}d`;
}
