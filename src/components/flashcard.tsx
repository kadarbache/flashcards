"use client";

import Link from "next/link";

/** What the two faces of a card have in common: everything but the text. */
interface FaceChrome {
  /** Shown top centre: the card's state in a review, "Practice" in a practice run. */
  label: string;
  position: number;
  total: number;
  menuOpen: boolean;
  onMenuToggle: () => void;
  /** Leave out where cards are only looked at; the menu item goes with it. */
  onDelete?: () => void;
  deckId: string;
  deckName: string;
}

/**
 * The flipping card, shared by the review and practice screens.
 *
 * It only draws. Which card is up, whether it is turned over and what happens
 * next all belong to the screen using it.
 */
export function Flashcard({
  front,
  back,
  flipped,
  onFlip,
  dimmed = false,
  ...chrome
}: FaceChrome & {
  front: string;
  back: string;
  flipped: boolean;
  onFlip: (flipped: boolean) => void;
  /** Faded while the screen is waiting on the server. */
  dimmed?: boolean;
}) {
  return (
    <div
      className={`w-full [perspective:1400px] transition-opacity ${
        dimmed ? "opacity-60" : ""
      }`}
    >
      <div
        className={`relative min-h-[26rem] w-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:duration-0 ${
          flipped ? "[transform:rotateY(180deg)]" : ""
        }`}
      >
        <CardFace
          {...chrome}
          text={front}
          footer="See answer"
          onFooterClick={() => onFlip(true)}
        />
        <CardFace
          {...chrome}
          back
          text={back}
          footer="Back to question"
          onFooterClick={() => onFlip(false)}
        />
      </div>
    </div>
  );
}

interface FaceProps extends FaceChrome {
  text: string;
  footer: string;
  onFooterClick: () => void;
  back?: boolean;
}

/**
 * One side of the flip. Both faces are stacked in the same box with
 * `backface-visibility: hidden`, so whichever one is turned away is invisible
 * and the card reads as a single object rotating rather than two swapping.
 */
function CardFace({
  text,
  label,
  position,
  total,
  footer,
  onFooterClick,
  menuOpen,
  onMenuToggle,
  onDelete,
  deckId,
  deckName,
  back = false,
}: FaceProps) {
  return (
    <div
      className={`absolute inset-0 flex flex-col rounded-3xl border border-border-subtle bg-surface-raised p-5 [backface-visibility:hidden] ${
        back ? "[transform:rotateY(180deg)]" : ""
      }`}
    >
      <div className="flex items-start justify-between text-xs">
        <span className="tabular-nums text-ink-muted">
          {position} / {Math.max(total, position)}
        </span>
        <span className="font-medium text-good">{label}</span>
        <div className="relative">
          <button
            type="button"
            onClick={onMenuToggle}
            aria-label="Card options"
            aria-expanded={menuOpen}
            className="-mt-1 rounded-full px-2 py-1 text-base leading-none text-ink-muted hover:text-ink"
          >
            &#8942;
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-border-subtle bg-surface-raised text-left shadow-lg">
              <Link
                href={`/decks/${deckId}`}
                className="block truncate px-3 py-2 text-xs hover:bg-surface"
              >
                {deckName}
              </Link>
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="block w-full px-3 py-2 text-left text-xs text-again hover:bg-surface"
                >
                  Delete this card
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/*
       * The faces are absolutely positioned to sit on top of each other, so a
       * long answer has nowhere to push the box -- it scrolls inside instead.
       * `break-words` covers a single unbroken string longer than the card.
       */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-2 py-6">
        <p
          className={`text-center break-words whitespace-pre-wrap ${
            back ? "text-xl text-ink-muted" : "text-2xl font-medium"
          }`}
        >
          {text}
        </p>
      </div>

      <button
        type="button"
        onClick={onFooterClick}
        className="mx-auto rounded-full px-3 py-1 text-xs text-ink-muted hover:text-ink"
      >
        {footer}
      </button>
    </div>
  );
}

/** The quiet controls under the card: undo and skip, or back and next. */
export function GhostButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-ink-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
    >
      {children}
    </button>
  );
}

export function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3.5 w-3.5 shrink-0 ${direction === "left" ? "" : "rotate-180"}`}
      aria-hidden="true"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
