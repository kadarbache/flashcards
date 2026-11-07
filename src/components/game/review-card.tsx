"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ArrowIcon, FlipIcon, MoreIcon } from "@/components/icons";
import { cardSpeaker, SpeakerButton } from "@/components/speaker";
import { splitLabel } from "@/lib/blitz";
import type { ReviewCardView } from "@/lib/decks";

import { MOVES, stateChip } from "./grades";
import {
  flingTransform,
  SWIPE_SURFACE,
  useSwipe,
  type Direction,
  type SwipeFrame,
} from "./use-swipe";

/** Pixels of drag that count as an answer when you let go. */
export const SWIPE_THRESHOLD = 110;

const STAMP_PLACE: Record<Direction, string> = {
  right: "top-14 left-5 -rotate-12",
  left: "top-14 right-5 rotate-12",
  up: "bottom-16 left-1/2 -translate-x-1/2 -rotate-6",
  down: "top-14 left-1/2 -translate-x-1/2 rotate-6",
};

/** Smaller type for longer text, so most answers fit without scrolling. */
function sizeFor(text: string, big: boolean): string {
  const length = text.length;
  if (big) {
    if (length > 120) return "text-xl";
    if (length > 50) return "text-2xl";
    return "text-[clamp(1.85rem,7vw,2.6rem)]";
  }
  if (length > 180) return "text-base";
  if (length > 90) return "text-lg";
  return "text-2xl";
}

/**
 * The card on the review screen. Tap it to turn it over; once it is face up,
 * drag it one of four ways to answer. A stamp on the card says where that
 * answer sends it ("Good, back in 4d").
 *
 * It keeps no game state. `leaving` comes from the screen, so a key press
 * throws the card out the same way a swipe does.
 */
export function ReviewCard({
  card,
  flipped,
  onFlip,
  leaving,
  disabled,
  onFrame,
  onSwipe,
  position,
  total,
  deckId,
  deckName,
  onDelete,
  aiVoice,
}: {
  card: ReviewCardView;
  flipped: boolean;
  onFlip: (flipped: boolean) => void;
  leaving: Direction | null;
  disabled: boolean;
  onFrame: (frame: SwipeFrame) => void;
  onSwipe: (direction: Direction) => void;
  position: number;
  total: number;
  deckId: string;
  deckName: string;
  onDelete: () => void;
  /** Read the word aloud with the AI voice, falling back to the device's. */
  aiVoice: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const stamps = useRef<Partial<Record<Direction, HTMLDivElement | null>>>({});

  function paintStamps(direction: Direction | null, progress: number) {
    for (const move of MOVES) {
      const stamp = stamps.current[move.direction];
      if (!stamp) continue;
      const on = move.direction === direction;
      stamp.style.opacity = on ? String(Math.min(1, progress * 1.4)) : "0";
      stamp.style.scale = on ? String(0.85 + progress * 0.15) : "0.85";
    }
  }

  const element = useRef<HTMLDivElement>(null);
  const swipe = useSwipe(element, {
    axis: "both",
    threshold: SWIPE_THRESHOLD,
    canSwipe: flipped && !disabled && leaving === null,
    locked: disabled || leaving !== null,
    onTap: () => {
      if (disabled || leaving !== null) return;
      setMenuOpen(false);
      onFlip(!flipped);
    },
    onFrame: (frame) => {
      paintStamps(frame.direction, frame.progress);
      onFrame(frame);
    },
    onSwipe,
  });
  const { handlers, setTransform, springBack } = swipe;

  // A key press or a finished swipe: throw the card out that way. If the
  // answer fails, `leaving` goes back to null and the card springs home.
  const wasLeaving = useRef(false);
  useEffect(() => {
    if (leaving) {
      wasLeaving.current = true;
      paintStamps(leaving, 1);
      setTransform(flingTransform(leaving), "transform 240ms cubic-bezier(.5,0,.75,0)");
    } else if (wasLeaving.current) {
      wasLeaving.current = false;
      paintStamps(null, 0);
      springBack();
    }
    // paintStamps only touches refs; listing it would re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const back = splitLabel(card.back);
  const chip = stateChip(card.stateLabel);

  return (
    <div
      ref={element}
      {...handlers}
      className={`anim-card-in absolute inset-0 cursor-grab active:cursor-grabbing ${SWIPE_SURFACE}`}
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
          <Face hidden={flipped}>
            <FaceTop chip={chip} label={card.stateLabel} position={position} total={total} />
            <div className="flex flex-1 items-center justify-center overflow-y-auto px-2 py-4">
              <p
                className={`text-center leading-tight font-extrabold tracking-tight break-words whitespace-pre-wrap ${sizeFor(card.front, true)}`}
              >
                {card.front}
              </p>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-paper-muted">
              <FlipIcon className="h-4 w-4" />
              Tap to flip
            </p>
          </Face>

          <Face back hidden={!flipped}>
            <FaceTop chip={chip} label={card.stateLabel} position={position} total={total} />
            <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-2 py-4 text-center">
              <div className="flex max-w-full items-center justify-center gap-2">
                <p className="min-w-0 text-base font-bold break-words text-paper-muted">{card.front}</p>
                <SpeakerButton text={card.front} aiVoice={aiVoice} className={cardSpeaker} />
              </div>
              <span className="h-1 w-10 rounded-full bg-[#e4dcfd]" aria-hidden="true" />
              {back.label && (
                <span className="rounded-full bg-[#efeafe] px-2.5 py-0.5 text-xs font-extrabold text-[#5b4bb0]">
                  {back.label}
                </span>
              )}
              <p
                className={`leading-snug font-bold break-words whitespace-pre-wrap ${sizeFor(back.text, false)}`}
              >
                {back.text}
              </p>
              {card.example && (
                <p className="max-w-prose text-sm leading-snug break-words text-paper-muted italic">
                  “{card.example}”
                </p>
              )}
            </div>
            <p className="flex items-center justify-center gap-2 text-sm font-bold text-paper-muted">
              <ArrowIcon direction="left" className="h-4 w-4" />
              Swipe to answer
              <ArrowIcon direction="right" className="h-4 w-4" />
            </p>
          </Face>
        </div>
      </div>

      {/* Stamps sit outside the flipping part, so they never read mirrored. */}
      {MOVES.map((move) => (
        <div
          key={move.direction}
          ref={(element) => {
            stamps.current[move.direction] = element;
          }}
          aria-hidden="true"
          className={`pointer-events-none absolute z-10 rounded-2xl border-[5px] bg-paper/90 px-3.5 py-1.5 text-center opacity-0 ${STAMP_PLACE[move.direction]}`}
          style={{ borderColor: move.deep, color: move.deep, scale: "0.85" }}
        >
          <p className="text-[1.75rem] leading-none font-black tracking-wide uppercase">
            {move.label}
          </p>
          <p className="mt-1 text-xs font-extrabold whitespace-nowrap">
            back in {card.previews[move.grade]}
          </p>
        </div>
      ))}

      <div className="absolute top-3.5 right-3.5 z-20">
        <button
          ref={menuButton}
          type="button"
          onClick={() => setMenuOpen((was) => !was)}
          aria-label="Card options"
          aria-expanded={menuOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-paper-muted transition hover:bg-[#efeafe] hover:text-paper-ink"
        >
          <MoreIcon className="h-5 w-5" />
        </button>
        {menuOpen && (
          <div className="anim-pop-in absolute right-0 mt-1 w-52 overflow-hidden rounded-2xl border border-[#e4dcfd] bg-white py-1 text-left text-paper-ink shadow-xl">
            <Link
              href={`/decks/${deckId}`}
              className="block truncate px-4 py-2.5 text-sm font-semibold hover:bg-[#f4f0ff]"
            >
              Open {deckName}
            </Link>
            <Link href="/help" className="block px-4 py-2.5 text-sm font-semibold hover:bg-[#f4f0ff]">
              How to play
            </Link>
            <button
              type="button"
              onClick={() => {
                // The menu closes, so the dialog hands the focus back to its button.
                menuButton.current?.focus();
                setMenuOpen(false);
                onDelete();
              }}
              className="block w-full px-4 py-2.5 text-left text-sm font-bold text-[#c0243f] hover:bg-[#fff0f2]"
            >
              Delete this card
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One side of the card. The side facing away is `hidden`: inert, so its
 * buttons cannot be tabbed to or tapped through the other side.
 */
function Face({
  back = false,
  hidden = false,
  children,
}: {
  back?: boolean;
  hidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      inert={hidden}
      className={`absolute inset-0 flex flex-col rounded-[28px] bg-paper p-5 text-paper-ink shadow-[0_28px_60px_-24px_rgba(0,0,0,.75)] [backface-visibility:hidden] sm:p-6 ${
        back ? "[transform:rotateY(180deg)]" : ""
      }`}
    >
      {children}
    </div>
  );
}

function FaceTop({
  chip,
  label,
  position,
  total,
}: {
  chip: { background: string; color: string };
  label: string;
  position: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-2 pr-11 text-xs font-extrabold">
      <span className="rounded-full px-2.5 py-1" style={chip}>
        {label}
      </span>
      <span className="ml-auto text-paper-muted tabular-nums">
        {position} / {Math.max(total, position)}
      </span>
    </div>
  );
}
