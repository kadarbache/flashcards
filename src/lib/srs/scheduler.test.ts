import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDelay, previewIntervals, review } from "./scheduler.ts";
import {
  DEFAULT_CONFIG,
  newCard,
  type Grade,
  type ReviewState,
  type SchedulerConfig,
} from "./types.ts";

const NOW = new Date("2026-01-01T12:00:00.000Z");
/** Turns fuzz off so day-scale assertions can be exact. */
const NO_FUZZ: Partial<SchedulerConfig> = { fuzzRatio: 0 };

function at(
  card: ReviewState,
  grade: Grade,
  config: Partial<SchedulerConfig> = NO_FUZZ,
) {
  return review(card, grade, { now: NOW, config });
}

/** Minutes between NOW and a card's due date. */
function minutesOut(card: ReviewState): number {
  return (card.due.getTime() - NOW.getTime()) / 60_000;
}

function reviewCard(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    ...newCard(NOW),
    state: "review",
    intervalDays: 10,
    ease: 2.5,
    reps: 5,
    ...overrides,
  };
}

/** Walk a card through several answers in one sitting. */
function sequence(
  card: ReviewState,
  grades: Grade[],
  config: Partial<SchedulerConfig> = NO_FUZZ,
) {
  return grades.reduce((acc, grade) => at(acc, grade, config), card);
}

describe("new cards", () => {
  it("enters the learning ladder rather than getting an interval", () => {
    const card = at(newCard(NOW), "good");
    assert.equal(card.state, "learning");
    assert.equal(card.step, 1);
    assert.equal(card.intervalDays, 0);
    assert.equal(minutesOut(card), 10);
  });

  it("puts Again back on the first step", () => {
    const card = at(newCard(NOW), "again");
    assert.equal(card.state, "learning");
    assert.equal(card.step, 0);
    assert.equal(minutesOut(card), 1);
  });

  it("graduates straight to the easy interval on Easy", () => {
    const card = at(newCard(NOW), "easy");
    assert.equal(card.state, "review");
    assert.equal(card.intervalDays, DEFAULT_CONFIG.easyIntervalDays);
    assert.equal(minutesOut(card), 4 * 24 * 60);
  });

  it("counts every answer as a rep", () => {
    assert.equal(at(newCard(NOW), "again").reps, 1);
    assert.equal(sequence(newCard(NOW), ["again", "good", "good"]).reps, 3);
  });

  it("leaves ease alone while the card is being learned", () => {
    const card = sequence(newCard(NOW), ["again", "hard", "good"]);
    assert.equal(card.ease, DEFAULT_CONFIG.startingEase);
  });
});

describe("the learning ladder", () => {
  it("graduates with the graduating interval off the end of the ladder", () => {
    // Two default steps, so the second Good graduates the card.
    const card = sequence(newCard(NOW), ["good", "good"]);
    assert.equal(card.state, "review");
    assert.equal(card.intervalDays, DEFAULT_CONFIG.graduatingIntervalDays);
  });

  it("repeats the current step on Hard without advancing", () => {
    const onSecondStep = at(newCard(NOW), "good");
    const card = at(onSecondStep, "hard");
    assert.equal(card.step, onSecondStep.step);
    assert.equal(minutesOut(card), 10);
  });

  it("drops back to the first step on Again", () => {
    const card = sequence(newCard(NOW), ["good", "again"]);
    assert.equal(card.state, "learning");
    assert.equal(card.step, 0);
    assert.equal(minutesOut(card), 1);
  });

  it("clamps a step that no longer exists on a shortened ladder", () => {
    const stranded: ReviewState = {
      ...newCard(NOW),
      state: "learning",
      step: 7,
    };
    const card = at(stranded, "hard", { ...NO_FUZZ, learningStepsMinutes: [5] });
    assert.equal(minutesOut(card), 5);
  });

  it("graduates on Good when the ladder has a single step", () => {
    const card = review(newCard(NOW), "good", {
      now: NOW,
      config: { ...NO_FUZZ, learningStepsMinutes: [1] },
    });
    assert.equal(card.state, "review");
  });
});

describe("review intervals", () => {
  it("multiplies by ease on Good", () => {
    const card = at(reviewCard({ intervalDays: 10, ease: 2.5 }), "good");
    assert.equal(card.intervalDays, 25);
    assert.equal(card.ease, 2.5, "Good leaves ease unchanged");
  });

  it("multiplies by the hard multiplier, not ease, on Hard", () => {
    const card = at(reviewCard({ intervalDays: 10, ease: 2.5 }), "hard");
    assert.equal(card.intervalDays, 12);
    assert.equal(card.ease, 2.35);
  });

  it("applies the easy bonus on top of ease", () => {
    const card = at(reviewCard({ intervalDays: 10, ease: 2.5 }), "easy");
    // 10 * 2.5 * 1.3, using the ease the card came in with.
    assert.equal(card.intervalDays, 33);
    assert.equal(card.ease, 2.65);
  });

  it("uses the incoming ease for the interval, not the adjusted one", () => {
    const card = at(reviewCard({ intervalDays: 10, ease: 2.5 }), "easy");
    const ifAdjustedFirst = Math.round(10 * 2.65 * 1.3);
    assert.notEqual(card.intervalDays, ifAdjustedFirst);
  });

  it("never returns an interval shorter than the previous one", () => {
    // At the ease floor, 10 * 1.3 rounds to 13; but a low hard multiplier would
    // otherwise shrink the interval, which should never happen.
    const card = at(reviewCard({ intervalDays: 10, ease: 1.3 }), "hard", {
      ...NO_FUZZ,
      hardMultiplier: 0.5,
    });
    assert.ok(card.intervalDays > 10, `got ${card.intervalDays}`);
  });

  it("caps intervals at the configured maximum", () => {
    const card = at(reviewCard({ intervalDays: 30_000, ease: 2.5 }), "good");
    assert.equal(card.intervalDays, DEFAULT_CONFIG.maxIntervalDays);
  });

  it("sets due from the interval it just computed", () => {
    const card = at(reviewCard({ intervalDays: 10, ease: 2.5 }), "good");
    assert.equal(minutesOut(card), card.intervalDays * 24 * 60);
  });
});

describe("ease", () => {
  it("has a floor that repeated Hard answers cannot breach", () => {
    let card = reviewCard({ ease: 1.4 });
    for (let i = 0; i < 10; i++) card = at(card, "hard");
    assert.equal(card.ease, DEFAULT_CONFIG.minEase);
  });

  it("has a floor that repeated lapses cannot breach", () => {
    let card = reviewCard({ ease: 1.4 });
    for (let i = 0; i < 10; i++) {
      card = at(card, "again");
      card = { ...card, state: "review" }; // shortcut back to review
    }
    assert.equal(card.ease, DEFAULT_CONFIG.minEase);
  });

  it("stays clear of floating-point drift", () => {
    const card = sequence(reviewCard({ ease: 2.5 }), ["hard", "easy"]);
    assert.equal(card.ease, 2.5);
  });
});

describe("lapses", () => {
  it("sends a review card back to relearning on Again", () => {
    const card = at(reviewCard({ intervalDays: 40 }), "again");
    assert.equal(card.state, "relearning");
    assert.equal(card.step, 0);
    assert.equal(minutesOut(card), 10);
  });

  it("counts the lapse and cuts the ease", () => {
    const card = at(reviewCard({ intervalDays: 40, ease: 2.5, lapses: 2 }), "again");
    assert.equal(card.lapses, 3);
    assert.equal(card.ease, 2.3);
  });

  it("holds the post-lapse interval until relearning finishes", () => {
    const lapsed = at(reviewCard({ intervalDays: 40 }), "again");
    assert.equal(lapsed.intervalDays, 1, "default config resets the interval");

    const recovered = at(lapsed, "good");
    assert.equal(recovered.state, "review");
    assert.equal(recovered.intervalDays, 1);
  });

  it("keeps a fraction of the interval when configured to", () => {
    const card = at(reviewCard({ intervalDays: 40 }), "again", {
      ...NO_FUZZ,
      lapseMultiplier: 0.5,
    });
    assert.equal(card.intervalDays, 20);
  });

  it("restores the pending interval when relearning ends on Easy", () => {
    const lapsed = at(reviewCard({ intervalDays: 40 }), "again", {
      ...NO_FUZZ,
      lapseMultiplier: 0.5,
    });
    const recovered = at(lapsed, "easy", { ...NO_FUZZ, lapseMultiplier: 0.5 });
    assert.equal(recovered.state, "review");
    assert.equal(recovered.intervalDays, 20);
  });

  it("stays in review when no relearning ladder is configured", () => {
    const card = at(reviewCard({ intervalDays: 40 }), "again", {
      ...NO_FUZZ,
      relearningStepsMinutes: [],
    });
    assert.equal(card.state, "review");
    assert.equal(card.lapses, 1);
    assert.equal(minutesOut(card), 24 * 60);
  });

  it("re-lapses from relearning back to the first relearning step", () => {
    const card = sequence(reviewCard({ intervalDays: 40 }), ["again", "again"]);
    assert.equal(card.state, "relearning");
    assert.equal(card.step, 0);
    assert.equal(card.lapses, 1, "only the review-state lapse counts");
  });
});

describe("fuzz", () => {
  it("spreads long intervals across a band around the exact value", () => {
    const card = reviewCard({ intervalDays: 100, ease: 2.5 });
    const low = review(card, "good", { now: NOW, random: () => 0 });
    const high = review(card, "good", { now: NOW, random: () => 0.999 });

    assert.equal(low.intervalDays, 238); // 250 - 5%
    assert.equal(high.intervalDays, 263); // 250 + 5%
    assert.ok(low.intervalDays < high.intervalDays);
  });

  it("leaves short intervals alone", () => {
    const card = reviewCard({ intervalDays: 1, ease: 2.5 });
    const low = review(card, "hard", { now: NOW, random: () => 0 });
    const high = review(card, "hard", { now: NOW, random: () => 0.999 });
    assert.equal(low.intervalDays, high.intervalDays);
  });

  it("does not fuzz the graduating interval", () => {
    const onLastStep = review(newCard(NOW), "good", { now: NOW });
    const low = review(onLastStep, "good", { now: NOW, random: () => 0 });
    const high = review(onLastStep, "good", { now: NOW, random: () => 0.999 });
    assert.equal(low.intervalDays, 1);
    assert.equal(high.intervalDays, 1);
  });

  it("stays within the band over many draws", () => {
    const card = reviewCard({ intervalDays: 100, ease: 2.5 });
    for (let i = 0; i < 200; i++) {
      const next = review(card, "good", { now: NOW });
      assert.ok(
        next.intervalDays >= 238 && next.intervalDays <= 263,
        `interval ${next.intervalDays} escaped the fuzz band`,
      );
    }
  });
});

describe("purity", () => {
  it("does not mutate the card it was given", () => {
    const card = reviewCard({ intervalDays: 10, ease: 2.5 });
    const snapshot = { ...card, due: new Date(card.due) };
    at(card, "easy");
    assert.deepEqual(card, snapshot);
  });

  it("returns a fresh due date rather than the old object", () => {
    const card = reviewCard();
    const next = at(card, "good");
    assert.notEqual(next.due, card.due);
  });
});

describe("button previews", () => {
  it("labels all four buttons for a new card", () => {
    const preview = previewIntervals(newCard(NOW), { now: NOW });
    assert.deepEqual(preview, {
      again: "1m",
      hard: "1m",
      good: "10m",
      easy: "4d",
    });
  });

  it("orders the labels by how far out they push the card", () => {
    const card = reviewCard({ intervalDays: 30, ease: 2.5 });
    const preview = previewIntervals(card, { now: NOW, config: NO_FUZZ });
    assert.deepEqual(preview, {
      again: "10m",
      hard: "1.2mo",
      good: "2.5mo",
      easy: "3.2mo",
    });
  });
});

describe("formatDelay", () => {
  const cases: Array<[number, string]> = [
    [30_000, "<1m"],
    [60_000, "1m"],
    [10 * 60_000, "10m"],
    [90 * 60_000, "2h"],
    [26 * 3_600_000, "1d"],
    [10 * 86_400_000, "10d"],
    [45 * 86_400_000, "1.5mo"],
    [400 * 86_400_000, "1.1y"],
  ];

  for (const [ms, expected] of cases) {
    it(`formats ${ms}ms as ${expected}`, () => {
      assert.equal(formatDelay(ms), expected);
    });
  }
});
