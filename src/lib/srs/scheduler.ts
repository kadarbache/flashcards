import {
  DEFAULT_CONFIG,
  GRADES,
  type CardState,
  type Grade,
  type ReviewState,
  type SchedulerConfig,
} from "./types.ts";

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Intervals below this many days are left unfuzzed. Spreading a one-day
 * interval by 5% moves it by an hour, which is noise, not load-balancing.
 */
const FUZZ_THRESHOLD_DAYS = 2.5;

export interface ReviewOptions {
  /** Treated as the moment the answer was given. Injected so tests are stable. */
  now?: Date;
  config?: Partial<SchedulerConfig>;
  /** Source of randomness for interval fuzz. Injected so tests are stable. */
  random?: () => number;
}

/**
 * Apply one answer to one card.
 *
 * Pure: it reads `card` and returns a new `ReviewState`, mutating nothing. All
 * of the scheduling behaviour lives here, which is what makes it possible to
 * test the interesting cases without a database or a browser.
 */
export function review(
  card: ReviewState,
  grade: Grade,
  options: ReviewOptions = {},
): ReviewState {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;

  const base: ReviewState = { ...card, reps: card.reps + 1 };

  switch (card.state) {
    // A new card is just a learning card that has not started its ladder yet.
    case "new":
      return gradeLadder({ ...base, state: "learning", step: 0 }, grade, {
        config,
        now,
        random,
        steps: config.learningStepsMinutes,
        ladder: "learning",
      });
    case "learning":
      return gradeLadder(base, grade, {
        config,
        now,
        random,
        steps: config.learningStepsMinutes,
        ladder: "learning",
      });
    case "relearning":
      return gradeLadder(base, grade, {
        config,
        now,
        random,
        steps: config.relearningStepsMinutes,
        ladder: "relearning",
      });
    case "review":
      return gradeReview(base, grade, { config, now, random });
  }
}

interface LadderContext {
  config: SchedulerConfig;
  now: Date;
  random: () => number;
  steps: number[];
  ladder: "learning" | "relearning";
}

/**
 * Grading for a card on the learning or relearning ladder.
 *
 * Ease is deliberately left alone here. A card still being learned has not
 * earned a meaningful ease yet, so pushing it around on every step would make
 * the first real interval mostly a function of how the learning went rather
 * than of how well the card is known.
 */
function gradeLadder(
  card: ReviewState,
  grade: Grade,
  ctx: LadderContext,
): ReviewState {
  const { config, now, random, steps, ladder } = ctx;

  if (grade === "easy") {
    // Easy skips the rest of the ladder. Out of relearning it restores the
    // interval the lapse left behind rather than jumping to the easy interval.
    const days =
      ladder === "relearning"
        ? Math.max(card.intervalDays, config.graduatingIntervalDays)
        : config.easyIntervalDays;
    return graduate(card, days, config, random, now);
  }

  if (grade === "again") {
    return {
      ...card,
      state: ladder,
      step: 0,
      due: afterMinutes(now, stepDelay(steps, 0)),
    };
  }

  if (grade === "hard") {
    // Repeat the current step rather than advancing.
    return {
      ...card,
      state: ladder,
      step: card.step,
      due: afterMinutes(now, stepDelay(steps, card.step)),
    };
  }

  // Good advances one rung, and graduates off the end of the ladder.
  const nextStep = card.step + 1;
  if (nextStep >= steps.length) {
    const days =
      ladder === "relearning"
        ? Math.max(card.intervalDays, config.graduatingIntervalDays)
        : config.graduatingIntervalDays;
    return graduate(card, days, config, random, now);
  }

  return {
    ...card,
    state: ladder,
    step: nextStep,
    due: afterMinutes(now, stepDelay(steps, nextStep)),
  };
}

/** Move a card onto the review queue with a day-scale interval. */
function graduate(
  card: ReviewState,
  days: number,
  config: SchedulerConfig,
  random: () => number,
  now: Date,
): ReviewState {
  const interval = clampInterval(fuzz(days, config, random), config);
  return {
    ...card,
    state: "review",
    step: 0,
    intervalDays: interval,
    due: afterDays(now, interval),
  };
}

function gradeReview(
  card: ReviewState,
  grade: Grade,
  ctx: { config: SchedulerConfig; now: Date; random: () => number },
): ReviewState {
  const { config, now, random } = ctx;
  const previous = Math.max(card.intervalDays, 1);

  if (grade === "again") {
    const ease = adjustEase(card.ease, "again", config);
    // The post-lapse interval is decided now and handed back to the card when
    // it finishes relearning.
    const pending = clampInterval(
      Math.max(config.graduatingIntervalDays, previous * config.lapseMultiplier),
      config,
    );
    const steps = config.relearningStepsMinutes;

    if (steps.length === 0) {
      // No relearning ladder configured: the card stays in review with the
      // shortened interval.
      return {
        ...card,
        ease,
        state: "review",
        step: 0,
        lapses: card.lapses + 1,
        intervalDays: pending,
        due: afterDays(now, pending),
      };
    }

    return {
      ...card,
      ease,
      state: "relearning",
      step: 0,
      lapses: card.lapses + 1,
      intervalDays: pending,
      due: afterMinutes(now, stepDelay(steps, 0)),
    };
  }

  // Intervals are computed with the ease the card had coming in; the ease
  // adjustment applies to the next review. Doing it the other way round makes
  // an easy answer compound twice.
  const grown = grownInterval(previous, grade, card.ease, config);
  // Never let a successful answer shorten the interval.
  const interval = clampInterval(
    Math.max(previous + 1, fuzz(grown, config, random)),
    config,
  );

  return {
    ...card,
    ease: adjustEase(card.ease, grade, config),
    state: "review",
    step: 0,
    intervalDays: interval,
    due: afterDays(now, interval),
  };
}

function grownInterval(
  previous: number,
  grade: Exclude<Grade, "again">,
  ease: number,
  config: SchedulerConfig,
): number {
  switch (grade) {
    case "hard":
      return previous * config.hardMultiplier;
    case "good":
      return previous * ease;
    case "easy":
      return previous * ease * config.easyBonus;
  }
}

function adjustEase(
  ease: number,
  grade: Grade,
  config: SchedulerConfig,
): number {
  return round2(Math.max(config.minEase, ease + config.easeDelta[grade]));
}

/**
 * Spread a day-scale interval slightly so that cards learned in one sitting do
 * not come back as one indivisible clump months later.
 */
function fuzz(
  days: number,
  config: SchedulerConfig,
  random: () => number,
): number {
  if (days < FUZZ_THRESHOLD_DAYS || config.fuzzRatio <= 0) {
    return Math.round(days);
  }
  const spread = days * config.fuzzRatio;
  const low = Math.max(2, Math.round(days - spread));
  const high = Math.max(low, Math.round(days + spread));
  return low + Math.floor(random() * (high - low + 1));
}

function clampInterval(days: number, config: SchedulerConfig): number {
  return Math.min(config.maxIntervalDays, Math.max(1, Math.round(days)));
}

/**
 * Ladders can be shorter than a card's recorded step (deck settings may have
 * changed under it), so clamp rather than reading past the end.
 */
function stepDelay(steps: number[], index: number): number {
  if (steps.length === 0) return 1;
  return steps[Math.min(Math.max(index, 0), steps.length - 1)];
}

function afterMinutes(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * MINUTE);
}

function afterDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What each button would do to this card, for labelling the buttons in the UI.
 * Fuzz is pinned to its midpoint so the label matches what the user gets
 * closely enough, without the label itself consuming randomness.
 */
export function previewIntervals(
  card: ReviewState,
  options: Omit<ReviewOptions, "random"> = {},
): Record<Grade, string> {
  const result = {} as Record<Grade, string>;
  const now = options.now ?? new Date();
  for (const grade of GRADES) {
    const next = review(card, grade, { ...options, now, random: () => 0.5 });
    result[grade] = formatDelay(next.due.getTime() - now.getTime());
  }
  return result;
}

/** "10m", "1d", "3.5mo" - short enough to sit on a button. */
export function formatDelay(ms: number): string {
  const minutes = ms / MINUTE;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return Math.round(minutes) + "m";
  const hours = minutes / 60;
  if (hours < 24) return Math.round(hours) + "h";
  const days = hours / 24;
  if (days < 30) return Math.round(days) + "d";
  const months = days / 30.42;
  if (months < 12) return trim(months) + "mo";
  return trim(days / 365.25) + "y";
}

function trim(value: number): string {
  return value < 10
    ? value.toFixed(1).replace(/\.0$/, "")
    : String(Math.round(value));
}

/** Human-readable state for the UI, kept next to the scheduler it describes. */
export function describeState(state: CardState): string {
  switch (state) {
    case "new":
      return "New";
    case "learning":
      return "Learning";
    case "review":
      return "Review";
    case "relearning":
      return "Relearning";
  }
}
