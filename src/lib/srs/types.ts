/**
 * Types for the spaced-repetition scheduler.
 *
 * Nothing in `src/lib/srs` knows about MongoDB, React or HTTP. The scheduler is
 * a pure function over these plain values, so it can be unit-tested and
 * swapped out (for FSRS, say) without touching the rest of the app.
 */

/** The four grading buttons, in the order they are shown. */
export const GRADES = ["again", "hard", "good", "easy"] as const;

export type Grade = (typeof GRADES)[number];

/**
 * Where a card sits in its lifecycle.
 *
 * - `new`        — never answered.
 * - `learning`   — walking the short learning ladder before its first real interval.
 * - `review`     — graduated; intervals grow by the SM-2 formula.
 * - `relearning` — was in review, got `again`, walking the relearning ladder.
 */
export type CardState = "new" | "learning" | "review" | "relearning";

/** The scheduling half of a card. The content (front/back) is irrelevant here. */
export interface ReviewState {
  state: CardState;
  /** Position on the learning or relearning ladder. Meaningless in `review`. */
  step: number;
  /**
   * Current interval in whole days. `0` while a card is on a learning ladder.
   * During `relearning` this holds the interval the card will get back when it
   * finishes relearning.
   */
  intervalDays: number;
  /** SM-2 ease factor. 2.5 is the default; never allowed below `minEase`. */
  ease: number;
  /** When the card next comes up. */
  due: Date;
  /** How many times the card has dropped out of `review`. */
  lapses: number;
  /** Total number of answers, all states included. */
  reps: number;
}

export interface SchedulerConfig {
  /** Delays, in minutes, for a new card's learning ladder. */
  learningStepsMinutes: number[];
  /** Delays, in minutes, for a lapsed card's relearning ladder. */
  relearningStepsMinutes: number[];
  /** Interval given when a card graduates with `good`. */
  graduatingIntervalDays: number;
  /** Interval given when a card skips the ladder with `easy`. */
  easyIntervalDays: number;
  startingEase: number;
  /** Hard floor on ease. Below roughly this, intervals stop growing usefully. */
  minEase: number;
  /** Extra multiplier applied on top of ease for `easy`. */
  easyBonus: number;
  /** Multiplier for `hard`. Does not use ease, by design. */
  hardMultiplier: number;
  /** What fraction of the interval survives a lapse. Anki's default is 0. */
  lapseMultiplier: number;
  /** Interval ceiling, so a card cannot disappear for a century. */
  maxIntervalDays: number;
  /** Random spread applied to review intervals, as a fraction. */
  fuzzRatio: number;
  /** Ease adjustment per grade, applied after the interval is computed. */
  easeDelta: Record<Grade, number>;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  startingEase: 2.5,
  minEase: 1.3,
  easyBonus: 1.3,
  hardMultiplier: 1.2,
  lapseMultiplier: 0,
  maxIntervalDays: 36500,
  fuzzRatio: 0.05,
  easeDelta: { again: -0.2, hard: -0.15, good: 0, easy: 0.15 },
};

/** The scheduling state of a card that has never been answered. */
export function newCard(now: Date = new Date()): ReviewState {
  return {
    state: "new",
    step: 0,
    intervalDays: 0,
    ease: DEFAULT_CONFIG.startingEase,
    due: now,
    lapses: 0,
    reps: 0,
  };
}
