"use client";

import { useRef, type RefObject } from "react";

export type Direction = "left" | "right" | "up" | "down";

/** How far the card has been pulled, handed to `onFrame` on every move. */
export interface SwipeFrame {
  dx: number;
  dy: number;
  /** The way the card is leaning, or null while it is still near the middle. */
  direction: Direction | null;
  /** 0 at rest, 1 at the point where letting go counts as a swipe. */
  progress: number;
}

/**
 * Classes for the element that takes `useSwipe`'s handlers.
 *
 * `touch-none` on the card alone is not enough on phones. Browsers work out
 * what a finger does from the element it lands on up to the nearest scrollable
 * box, and a card's text area is scrollable (`overflow-y-auto`) so a long
 * answer fits. A drag starting on the text then belongs to the browser, which
 * cancels the pointer and the card snaps back. Turning off touch gestures for
 * everything inside the card keeps every drag ours. Taps and the mouse wheel
 * still work as normal.
 */
export const SWIPE_SURFACE = "touch-none select-none [&_*]:touch-none";

/** Movement under this many pixels is a tap, not a drag. */
const TAP_SLOP = 8;
/** Below this the card is "in the middle": no colour, no stamp. */
const DEAD_ZONE = 22;

export function directionOf(dx: number, dy: number, axis: "x" | "both"): Direction {
  if (axis === "x" || Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

/** Where a card goes when it leaves in `direction`. */
export function flingTransform(direction: Direction): string {
  switch (direction) {
    case "right":
      return "translate(135%, 4%) rotate(18deg)";
    case "left":
      return "translate(-135%, 4%) rotate(-18deg)";
    case "up":
      return "translate(0, -125%) rotate(-4deg)";
    case "down":
      return "translate(0, 125%) rotate(4deg)";
  }
}

/**
 * Drag a card with a finger or the mouse.
 *
 * Pass the card's ref. The card follows the pointer by writing its transform
 * straight onto that element, so a drag re-renders nothing. React only hears about the moments
 * that matter: a tap, a change of direction (`onFrame`, which the caller can
 * diff), and a finished swipe.
 */
export interface SwipeOptions {
  axis: "x" | "both";
  /** Pixels along the main axis that count as a swipe on release. */
  threshold: number;
  /** False keeps the card on a short leash: it wiggles but never leaves. */
  canSwipe: boolean;
  /** True ignores the pointer completely, e.g. while the card is flying off. */
  locked?: boolean;
  onTap?: () => void;
  onFrame?: (frame: SwipeFrame) => void;
  onSwipe: (direction: Direction) => void;
}

export function useSwipe<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { axis, threshold, canSwipe, locked = false, onTap, onFrame, onSwipe }: SwipeOptions,
) {
  const drag = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);

  function setTransform(transform: string, transition: string) {
    const element = ref.current;
    if (!element) return;
    element.style.transition = transition;
    element.style.transform = transform;
  }

  function frameFor(dx: number, dy: number): SwipeFrame {
    const direction = directionOf(dx, dy, axis);
    const distance = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    if (!canSwipe || distance < DEAD_ZONE) return { dx, dy, direction: null, progress: 0 };
    return { dx, dy, direction, progress: Math.min(1, (distance - DEAD_ZONE) / (threshold - DEAD_ZONE)) };
  }

  function springBack() {
    setTransform("", "transform 340ms cubic-bezier(.2,1.35,.4,1)");
    onFrame?.({ dx: 0, dy: 0, direction: null, progress: 0 });
  }

  const handlers = {
    onPointerDown(event: React.PointerEvent<T>) {
      if (locked || event.button !== 0) return;
      // Buttons and links inside the card do their own thing.
      if ((event.target as HTMLElement).closest("button, a")) return;
      drag.current = { x: event.clientX, y: event.clientY, t: performance.now(), moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      setTransform(ref.current?.style.transform ?? "", "none");
    },

    onPointerMove(event: React.PointerEvent<T>) {
      const start = drag.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = axis === "x" ? 0 : event.clientY - start.y;
      if (!start.moved && Math.hypot(dx, event.clientY - start.y) < TAP_SLOP) return;
      start.moved = true;

      if (!canSwipe) {
        // Not ready to answer yet: a little give, so it still feels physical.
        setTransform(`translate(${dx * 0.12}px, ${dy * 0.12}px)`, "none");
        return;
      }
      const tilt = axis === "x" ? dx * 0.03 : dx * 0.06;
      setTransform(`translate(${dx}px, ${dy}px) rotate(${tilt}deg)`, "none");
      onFrame?.(frameFor(dx, dy));
    },

    onPointerUp(event: React.PointerEvent<T>) {
      const start = drag.current;
      drag.current = null;
      if (!start) return;
      if (!start.moved) {
        onTap?.();
        return;
      }
      const dx = event.clientX - start.x;
      const dy = axis === "x" ? 0 : event.clientY - start.y;
      if (canSwipe) {
        const direction = directionOf(dx, dy, axis);
        const distance =
          direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
        const speed = distance / Math.max(1, performance.now() - start.t);
        // Far enough, or a quick flick.
        if (distance >= threshold || (distance > 48 && speed > 0.65)) {
          onSwipe(direction);
          return;
        }
      }
      springBack();
    },

    onPointerCancel() {
      if (!drag.current) return;
      drag.current = null;
      springBack();
    },
  };

  return { handlers, setTransform, springBack };
}
