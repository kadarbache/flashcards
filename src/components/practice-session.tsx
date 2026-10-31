"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Confetti } from "@/components/game/effects";
import { flingTransform, useSwipe, type Direction, type SwipeFrame } from "@/components/game/use-swipe";
import { ArrowIcon, BoltIcon, FlipIcon, PlayIcon, ShuffleIcon } from "@/components/icons";
import { iconButton, panel, primaryButton, secondaryButton } from "@/components/ui";
import { MIN_BLITZ_CARDS, splitLabel } from "@/lib/blitz";
import type { PracticeCard } from "@/lib/decks";
import { shuffled } from "@/lib/shuffle";

/** Each card gets the next colour in this ring, so neighbours never match. */
const HUES = ["#FFD24A", "#3EE0A1", "#6EA8FF", "#FF8FA3", "#B9A6FF", "#FFB547", "#5EE0E6", "#C8F06A"];
const hueAt = (index: number) => HUES[((index % HUES.length) + HUES.length) % HUES.length];

const glow = (color: string) =>
  `radial-gradient(110% 70% at 50% 42%, ${color}4d, ${color}10 55%, transparent 80%)`;

const FLY_MS = 230;
const SWIPE_THRESHOLD = 90;
/** Above this, a bar replaces the row of dots. */
const MAX_DOTS = 12;

/**
 * A run through the whole deck with nothing at stake.
 *
 * No Server Action is imported here, on purpose. The cards arrive as a prop
 * and every move after that -- flip, next, back, go again -- is local state,
 * so there is no path from this screen to a card's schedule or to the review
 * history. That is the whole difference from `ReviewSession`.
 *
 * Swipe left for the next card, right to go back. The background blends from
 * this card's colour to the next one's as you drag.
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
  const [leaving, setLeaving] = useState<Direction | null>(null);
  /** Which way the last move went, so the new card comes in from the right side. */
  const [cameFrom, setCameFrom] = useState<"next" | "back">("next");
  const [round, setRound] = useState(0);

  const blend = useRef<HTMLDivElement>(null);
  const behind = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const card = order[index] ?? null;
  const hue = hueAt(index);

  /** Paint the background and the card behind toward where you are heading. */
  const paint = useCallback(
    (direction: Direction | null, progress: number, animate = false) => {
      const target = direction === "right" ? hueAt(index - 1) : hueAt(index + 1);
      if (blend.current) {
        blend.current.style.transition = animate ? "opacity 220ms ease" : "none";
        blend.current.style.background = glow(target);
        blend.current.style.opacity = direction ? String(progress) : "0";
      }
      if (behind.current) {
        behind.current.style.background = target;
      }
    },
    [index],
  );

  const goTo = useCallback(
    (next: number, from: "next" | "back") => {
      setIndex(Math.max(0, Math.min(next, order.length)));
      setFlipped(false);
      setLeaving(null);
      setCameFrom(from);
      paint(null, 0);
    },
    [order.length, paint],
  );

  /** Throw the card out, then move. Left is forward, right is back. */
  const move = useCallback(
    (direction: "left" | "right") => {
      if (busy.current || !card) return;
      if (direction === "right" && index === 0) return;
      busy.current = true;
      setLeaving(direction);
      paint(direction, 1, true);
      setTimeout(() => {
        busy.current = false;
        goTo(direction === "left" ? index + 1 : index - 1, direction === "left" ? "next" : "back");
      }, FLY_MS);
    },
    [card, goTo, index, paint],
  );

  const back = useCallback(() => {
    // From the end screen there is no card to throw; just step back in.
    if (!card) goTo(order.length - 1, "back");
    else move("right");
  }, [card, goTo, move, order.length]);

  const restart = useCallback(() => {
    setOrder(shuffled(order));
    setRound((value) => value + 1);
    goTo(0, "next");
  }, [goTo, order]);

  /** The main button, and space: reveal the answer, then move on. */
  const advance = useCallback(() => {
    if (flipped) move("left");
    else setFlipped(true);
  }, [flipped, move]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
        return;
      }
      if (!card) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        move("left");
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        if (target?.closest("button, a")) return;
        event.preventDefault();
        advance();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, back, card, move]);

  if (order.length === 0) {
    return (
      <EndScreen title="No cards to practice" detail="Add some to this deck first.">
        <Link href={`/decks/${deckId}`} className={primaryButton}>
          Open {deckName}
        </Link>
      </EndScreen>
    );
  }

  if (!card) {
    const count = order.length;
    return (
      <EndScreen
        title="Whole deck done!"
        detail={`${count} ${count === 1 ? "card" : "cards"}, none of them graded. Your schedule is where you left it.`}
        celebrate
      >
        <button type="button" onClick={restart} className={`${primaryButton} sm:col-span-2`}>
          <ShuffleIcon className="h-5 w-5" />
          Shuffle and go again
        </button>
        <Link href={`/decks/${deckId}/review`} className={secondaryButton}>
          <PlayIcon className="h-5 w-5" />
          Play due cards
        </Link>
        {count >= MIN_BLITZ_CARDS ? (
          <Link href={`/decks/${deckId}/blitz`} className={secondaryButton}>
            <BoltIcon className="h-5 w-5 text-gold" />
            Blitz
          </Link>
        ) : (
          <Link href={`/decks/${deckId}`} className={secondaryButton}>
            Open {deckName}
          </Link>
        )}
        <button
          type="button"
          onClick={back}
          className="text-sm font-bold text-ink-muted hover:text-ink sm:col-span-2"
        >
          Back to the last card
        </button>
      </EndScreen>
    );
  }

  const isLast = index === order.length - 1;

  return (
    <div className="relative">
      {/* This card's colour, and over it the colour you are dragging toward. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: glow(hue) }}
      />
      <div ref={blend} aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 opacity-0" />

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-lg">
        <div className="flex items-center gap-2.5">
          <Link href={`/decks/${deckId}`} className={iconButton} aria-label={`Back to ${deckName}`}>
            <ArrowIcon direction="left" className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{deckName}</p>
            <p className="text-xs text-ink-muted">Practice · nothing is graded</p>
          </div>
          <span className="rounded-full bg-surface-raised px-3 py-2 text-sm font-extrabold tabular-nums">
            {index + 1} / {order.length}
          </span>
        </div>

        <Progress index={index} total={order.length} />

        <div className="relative mb-2 h-[clamp(18rem,calc(100dvh-22rem),27rem)]">
          {!isLast && (
            <div
              ref={behind}
              aria-hidden="true"
              className="absolute inset-0 translate-y-5 scale-[0.95] rounded-[28px] opacity-60"
              style={{ background: hueAt(index + 1) }}
            />
          )}
          <SwipeCard
            key={`${round}-${index}`}
            card={card}
            hue={hue}
            flipped={flipped}
            onFlip={setFlipped}
            leaving={leaving}
            enter={cameFrom === "back" ? "anim-slide-in-left" : "anim-card-in"}
            canGoBack={index > 0}
            onFrame={(frame) => paint(frame.direction, frame.progress)}
            onSwipe={(direction) => {
              if (direction === "left" || direction === "right") move(direction);
            }}
          />
        </div>

        <button
          type="button"
          onClick={advance}
          className={`${primaryButton} min-h-16 w-full text-lg`}
          style={{ background: hue }}
        >
          {flipped ? (isLast ? "Finish" : "Next card") : "Show answer"}
          <kbd className="hidden rounded-md bg-paper-ink/15 px-1.5 py-0.5 text-xs font-bold sm:inline">
            Space
          </kbd>
        </button>

        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 font-bold text-ink-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-30"
          >
            <ArrowIcon direction="left" className="h-4 w-4" />
            Back
          </button>
          <p className="min-w-0 flex-1 text-center text-xs text-ink-muted">
            <span className="sm:hidden">Swipe left for next, right to go back</span>
            <span className="hidden sm:inline">Drag the card, or use ← → and Space</span>
          </p>
          <button
            type="button"
            onClick={() => move("left")}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 font-bold text-ink-muted transition hover:bg-surface-raised hover:text-ink"
          >
            Next
            <ArrowIcon direction="right" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SwipeCard({
  card,
  hue,
  flipped,
  onFlip,
  leaving,
  enter,
  canGoBack,
  onFrame,
  onSwipe,
}: {
  card: PracticeCard;
  hue: string;
  flipped: boolean;
  onFlip: (flipped: boolean) => void;
  leaving: Direction | null;
  enter: string;
  canGoBack: boolean;
  onFrame: (frame: SwipeFrame) => void;
  onSwipe: (direction: Direction) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const swipe = useSwipe(element, {
    axis: "x",
    threshold: SWIPE_THRESHOLD,
    canSwipe: leaving === null,
    locked: leaving !== null,
    onTap: () => {
      if (leaving === null) onFlip(!flipped);
    },
    onFrame: (frame) => {
      // Nothing before the first card: lean, but no colour change.
      if (frame.direction === "right" && !canGoBack) onFrame({ ...frame, direction: null, progress: 0 });
      else onFrame(frame);
    },
    onSwipe: (direction) => {
      if (direction === "right" && !canGoBack) {
        swipe.springBack();
        return;
      }
      onSwipe(direction);
    },
  });
  const { handlers, setTransform } = swipe;

  useEffect(() => {
    if (leaving) setTransform(flingTransform(leaving), "transform 230ms cubic-bezier(.5,0,.75,0)");
  }, [leaving, setTransform]);

  const back = splitLabel(card.back);

  return (
    <div
      ref={element}
      {...handlers}
      className={`${enter} absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing`}
      role="group"
      aria-roledescription="flashcard"
      aria-label={flipped ? `Answer: ${card.back}` : `Question: ${card.front}`}
    >
      <div className="h-full [perspective:1400px]">
        <div
          className={`relative h-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:duration-0 ${
            flipped ? "[transform:rotateY(180deg)]" : ""
          }`}
        >
          <div
            className="absolute inset-0 flex flex-col rounded-[28px] p-6 text-paper-ink shadow-[0_28px_60px_-24px_rgba(0,0,0,.75)] [backface-visibility:hidden]"
            style={{ background: hue }}
          >
            <span className="w-fit rounded-full bg-paper-ink/10 px-2.5 py-1 text-xs font-extrabold">
              Practice
            </span>
            <div className="flex flex-1 items-center justify-center overflow-y-auto px-2 py-4">
              <p
                className={`text-center leading-tight font-extrabold tracking-tight break-words whitespace-pre-wrap ${
                  card.front.length > 50 ? "text-2xl" : "text-[clamp(1.85rem,7vw,2.6rem)]"
                }`}
              >
                {card.front}
              </p>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-sm font-bold opacity-70">
              <FlipIcon className="h-4 w-4" />
              Tap to flip
            </p>
          </div>

          <div
            className="absolute inset-0 flex flex-col rounded-[28px] border-[6px] bg-paper p-5 text-paper-ink shadow-[0_28px_60px_-24px_rgba(0,0,0,.75)] [backface-visibility:hidden] [transform:rotateY(180deg)]"
            style={{ borderColor: hue }}
          >
            <span className="w-fit rounded-full px-2.5 py-1 text-xs font-extrabold" style={{ background: hue }}>
              Answer
            </span>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-2 py-4 text-center">
              <p className="text-base font-bold break-words text-paper-muted">{card.front}</p>
              {back.label && (
                <span className="rounded-full bg-[#efeafe] px-2.5 py-0.5 text-xs font-extrabold text-[#5b4bb0]">
                  {back.label}
                </span>
              )}
              <p
                className={`leading-snug font-bold break-words whitespace-pre-wrap ${
                  back.text.length > 180 ? "text-base" : back.text.length > 90 ? "text-lg" : "text-2xl"
                }`}
              >
                {back.text}
              </p>
            </div>
            <p className="flex items-center justify-center gap-2 text-sm font-bold text-paper-muted">
              <ArrowIcon direction="left" className="h-4 w-4" />
              Swipe for the next card
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dots for a short deck, a bar for a long one. */
function Progress({ index, total }: { index: number; total: number }) {
  if (total <= MAX_DOTS) {
    return (
      <ol className="flex justify-center gap-1.5" aria-label={`Card ${index + 1} of ${total}`}>
        {Array.from({ length: total }, (_, i) => (
          <li
            key={i}
            className={`h-2 rounded-full transition-all duration-300 ${i === index ? "w-6" : "w-2"}`}
            style={{ background: i <= index ? hueAt(i) : "#2F2A4A" }}
          />
        ))}
      </ol>
    );
  }
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
      role="progressbar"
      aria-label="Practice progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={index + 1}
    >
      <div
        className="h-full rounded-full transition-[width,background-color] duration-300"
        style={{ width: `${((index + 1) / total) * 100}%`, background: hueAt(index) }}
      />
    </div>
  );
}

/** Shown instead of a card: an empty deck, or the end of a run. */
function EndScreen({
  title,
  detail,
  celebrate = false,
  children,
}: {
  title: string;
  detail: string;
  celebrate?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative mx-auto max-w-lg space-y-5 text-center">
      <Confetti fire={celebrate ? 1 : 0} />
      <div className={`${panel} anim-pop-in px-6 py-12`}>
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-ink-muted">{detail}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  );
}
