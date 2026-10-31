import type { Grade } from "@/lib/srs/types";

import type { Direction } from "./use-swipe";

/** One answer: which way you swipe it, the key that does it, and its colours. */
export interface GradeMove {
  grade: Grade;
  direction: Direction;
  label: string;
  /** Digit key; the arrow key for `direction` works too. */
  key: string;
  /** For the dark ground. */
  color: string;
  /** Darker, for stamps on the light paper card. */
  deep: string;
}

/** In the order the time hints show them: left, down, right, up. */
export const MOVES: GradeMove[] = [
  { grade: "again", direction: "left", label: "Again", key: "1", color: "#FF6B81", deep: "#D42F4F" },
  { grade: "hard", direction: "down", label: "Hard", key: "2", color: "#FFB547", deep: "#A86300" },
  { grade: "good", direction: "right", label: "Good", key: "3", color: "#3EE0A1", deep: "#0B8A5A" },
  { grade: "easy", direction: "up", label: "Easy", key: "4", color: "#6EA8FF", deep: "#2463D6" },
];

export function moveFor(direction: Direction): GradeMove {
  return MOVES.find((move) => move.direction === direction) ?? MOVES[2];
}

export const ARROW_KEYS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowDown: "down",
  ArrowRight: "right",
  ArrowUp: "up",
};

/** Chip colours for the card's state, on the paper card. */
export function stateChip(label: string): { background: string; color: string } {
  switch (label) {
    case "New":
      return { background: "#DCE8FF", color: "#1F4FB0" };
    case "Learning":
    case "Relearning":
      return { background: "#FFE0E5", color: "#A8203A" };
    default:
      return { background: "#D5F7E8", color: "#0B6A45" };
  }
}
