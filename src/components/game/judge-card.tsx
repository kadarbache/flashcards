"use client";

import { useRef } from "react";

import { SWIPE_SURFACE, useSwipe, type Direction, type SwipeFrame } from "@/components/game/use-swipe";
import { ArrowIcon, CheckIcon, CloseIcon, FlipIcon } from "@/components/icons";
import { cardSpeaker, SpeakerButton } from "@/components/speaker";
import { splitLabel } from "@/lib/blitz";
import type { WordResult } from "@/lib/word-of-the-day";

const SWIPE_THRESHOLD = 100;

/** Swipe right if you knew it, left if you did not -- the same sides as Good and Again. */
const STAMPS: { direction: Direction; result: WordResult; label: string; color: string; place: string }[] = [
  { direction: "right", result: "knew", label: "Knew it", color: "#0B8A5A", place: "top-14 left-5 -rotate-12" },
  { direction: "left", result: "missed", label: "Missed", color: "#D42F4F", place: "top-14 right-5 rotate-12" },
];

/**
 * A single card you read, flip, and judge: Knew it or Missed it, by button or
 * by swipe. Word of the Day and the boss fight both use it. It comes back to
 * the middle after the answer, since it is the only card on the screen.
 */
export function JudgeCard({
  label,
  front,
  back,
  deckName,
  badge,
  question,
  flipped,
  result,
  onFlip,
  onAnswer,
  aiVoice,
}: {
  /** What the card is, for screen readers: "Word of the day". */
  label: string;
  front: string;
  back: string;
  deckName: string;
  /** The pill in the card's top corner. */
  badge: React.ReactNode;
  /** The line above the word on the front. */
  question: string;
  flipped: boolean;
  result: WordResult | null;
  onFlip: () => void;
  onAnswer: (result: WordResult) => void;
  aiVoice: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const stamps = useRef<Partial<Record<Direction, HTMLDivElement | null>>>({});

  function paintStamps(frame: SwipeFrame) {
    for (const stamp of STAMPS) {
      const node = stamps.current[stamp.direction];
      if (!node) continue;
      const on = stamp.direction === frame.direction;
      node.style.opacity = on ? String(Math.min(1, frame.progress * 1.4)) : "0";
    }
  }

  const canAnswer = flipped && result === null;
  const { handlers, springBack } = useSwipe(element, {
    axis: "x",
    threshold: SWIPE_THRESHOLD,
    canSwipe: canAnswer,
    locked: result !== null,
    onTap: onFlip,
    onFrame: paintStamps,
    onSwipe: (direction) => {
      paintStamps({ dx: 0, dy: 0, direction: null, progress: 0 });
      springBack();
      const stamp = STAMPS.find((entry) => entry.direction === direction);
      if (stamp) onAnswer(stamp.result);
    },
  });

  const meaning = splitLabel(back);
  const ring = result === "knew" ? "ring-4 ring-good" : result === "missed" ? "ring-4 ring-again" : "";

  return (
    <div className="relative h-[clamp(17rem,calc(100dvh-26rem),24rem)]">
      <div
        ref={element}
        {...handlers}
        className={`anim-card-in absolute inset-0 ${result ? "" : "cursor-grab active:cursor-grabbing"} ${SWIPE_SURFACE}`}
        role="group"
        aria-roledescription="flashcard"
        aria-label={flipped ? `Answer: ${back}` : `${label}: ${front}`}
      >
        <div className="h-full [perspective:1400px]">
          <div
            className={`relative h-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:duration-0 ${
              flipped ? "[transform:rotateY(180deg)]" : ""
            }`}
          >
            <Face hidden={flipped}>
              <CardTop badge={badge} deckName={deckName} />
              <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-2 py-4 text-center">
                <p className="text-sm font-extrabold tracking-wide text-paper-muted uppercase">{question}</p>
                <p className="text-[clamp(2rem,8vw,3rem)] leading-tight font-extrabold tracking-tight break-words">
                  {front}
                </p>
              </div>
              <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-paper-muted">
                <FlipIcon className="h-4 w-4" />
                Say it in your head, then tap to flip
              </p>
            </Face>

            <Face back hidden={!flipped} ring={ring}>
              <CardTop badge={badge} deckName={deckName} />
              <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-2 py-4 text-center">
                <div className="flex max-w-full items-center justify-center gap-2">
                  <p className="min-w-0 text-lg font-extrabold break-words">{front}</p>
                  <SpeakerButton text={front} aiVoice={aiVoice} className={cardSpeaker} />
                </div>
                <span className="h-1 w-10 rounded-full bg-[#e4dcfd]" aria-hidden="true" />
                {meaning.label && (
                  <span className="rounded-full bg-[#efeafe] px-2.5 py-0.5 text-xs font-extrabold text-[#5b4bb0]">
                    {meaning.label}
                  </span>
                )}
                <p
                  className={`leading-snug font-bold break-words whitespace-pre-wrap ${
                    meaning.text.length > 160 ? "text-base" : meaning.text.length > 80 ? "text-lg" : "text-2xl"
                  }`}
                >
                  {meaning.text}
                </p>
              </div>
              {result === null && (
                <p className="flex items-center justify-center gap-2 text-sm font-bold text-paper-muted">
                  <ArrowIcon direction="left" className="h-4 w-4" />
                  Missed · Knew it
                  <ArrowIcon direction="right" className="h-4 w-4" />
                </p>
              )}
            </Face>
          </div>
        </div>

        {STAMPS.map((stamp) => (
          <div
            key={stamp.direction}
            ref={(node) => {
              stamps.current[stamp.direction] = node;
            }}
            aria-hidden="true"
            className={`pointer-events-none absolute z-10 rounded-2xl border-[5px] bg-paper/90 px-3.5 py-1.5 opacity-0 ${stamp.place}`}
            style={{ borderColor: stamp.color, color: stamp.color }}
          >
            <p className="text-[1.6rem] leading-none font-black tracking-wide uppercase">{stamp.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The Missed it / Knew it pair under a flipped card. */
export function JudgeButtons({
  prompt,
  disabled,
  onAnswer,
}: {
  prompt: string;
  disabled: boolean;
  onAnswer: (result: WordResult) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-center text-sm font-bold text-ink-muted">{prompt}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => onAnswer("missed")}
          disabled={disabled}
          className="inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-again text-lg font-extrabold text-paper-ink transition active:scale-[0.97] disabled:opacity-50"
        >
          <CloseIcon className="h-5 w-5" />
          Missed it
        </button>
        <button
          type="button"
          onClick={() => onAnswer("knew")}
          disabled={disabled}
          className="inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-good text-lg font-extrabold text-paper-ink transition active:scale-[0.97] disabled:opacity-50"
        >
          <CheckIcon className="h-5 w-5" />
          Knew it
        </button>
      </div>
    </div>
  );
}

/** One side of the card. The side facing away is `hidden`: inert, so its buttons cannot be reached. */
function Face({
  back = false,
  hidden = false,
  ring = "",
  children,
}: {
  back?: boolean;
  hidden?: boolean;
  ring?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      inert={hidden}
      className={`absolute inset-0 flex flex-col rounded-[28px] bg-paper p-5 text-paper-ink shadow-[0_28px_60px_-24px_rgba(0,0,0,.75)] [backface-visibility:hidden] sm:p-6 ${ring} ${
        back ? "[transform:rotateY(180deg)]" : ""
      }`}
    >
      {children}
    </div>
  );
}

function CardTop({ badge, deckName }: { badge: React.ReactNode; deckName: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-extrabold">
      {badge}
      {deckName && <span className="ml-auto truncate text-paper-muted">{deckName}</span>}
    </div>
  );
}
