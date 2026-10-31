import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampGoal,
  COMBO_PAUSE_MS,
  dayKey,
  lastSevenDays,
  levelFromXp,
  multiplierFor,
  nextCombo,
  previousDay,
  safeTimeZone,
  streakFrom,
  xpFor,
  xpForLevel,
} from "@/lib/game";

describe("xp", () => {
  it("pays the same base for every answer and multiplies with the combo", () => {
    assert.equal(xpFor(1), 10);
    assert.equal(xpFor(2), 10);
    assert.equal(xpFor(3), 15);
    assert.equal(xpFor(6), 20);
    assert.equal(xpFor(500), 20);
  });

  it("treats a bad combo from the client as no combo", () => {
    assert.equal(xpFor(Number.NaN), 10);
    assert.equal(xpFor(-4), 10);
    assert.equal(multiplierFor(0), 1);
  });
});

describe("nextCombo", () => {
  it("counts up while answers keep coming", () => {
    assert.equal(nextCombo(0, null, 1000), 1);
    assert.equal(nextCombo(4, 1000, 5000), 5);
  });

  it("starts again after a long pause", () => {
    assert.equal(nextCombo(9, 0, COMBO_PAUSE_MS + 1), 1);
  });
});

describe("levelFromXp", () => {
  it("starts at level 1 and needs more XP each level", () => {
    assert.deepEqual(levelFromXp(0), { level: 1, into: 0, needed: 200, rank: "Rookie" });
    assert.equal(xpForLevel(2), 250);
    const level = levelFromXp(200 + 250 + 10);
    assert.equal(level.level, 3);
    assert.equal(level.into, 10);
    assert.equal(level.rank, "Apprentice");
  });
});

describe("clampGoal", () => {
  it("keeps the goal in a sane range", () => {
    assert.equal(clampGoal(1), 5);
    assert.equal(clampGoal(37.4), 37);
    assert.equal(clampGoal(10_000), 200);
    assert.equal(clampGoal(Number.NaN), 20);
  });
});

describe("days", () => {
  it("cuts days on the player's calendar", () => {
    const lateEvening = new Date("2026-10-31T23:30:00Z");
    assert.equal(dayKey(lateEvening, "UTC"), "2026-10-31");
    assert.equal(dayKey(lateEvening, "Europe/Stockholm"), "2026-11-01");
  });

  it("steps back across months and years", () => {
    assert.equal(previousDay("2026-03-01"), "2026-02-28");
    assert.equal(previousDay("2027-01-01"), "2026-12-31");
  });

  it("falls back to UTC for an unknown time zone", () => {
    assert.equal(safeTimeZone("Not/AZone"), "UTC");
    assert.equal(safeTimeZone(undefined), "UTC");
    assert.equal(safeTimeZone("Africa/Mogadishu"), "Africa/Mogadishu");
  });
});

describe("streakFrom", () => {
  const goal = 10;

  it("keeps a streak alive through yesterday while today is unfinished", () => {
    const counts = new Map([
      ["2026-10-28", 12],
      ["2026-10-29", 10],
      ["2026-10-30", 20],
      ["2026-10-31", 3],
    ]);
    assert.deepEqual(streakFrom(counts, "2026-10-31", goal), {
      current: 3,
      best: 3,
      todayDone: false,
    });
  });

  it("counts today once the goal is reached", () => {
    const counts = new Map([
      ["2026-10-30", 10],
      ["2026-10-31", 10],
    ]);
    assert.equal(streakFrom(counts, "2026-10-31", goal).current, 2);
  });

  it("breaks on a missed day and remembers the best run", () => {
    const counts = new Map([
      ["2026-10-20", 10],
      ["2026-10-21", 10],
      ["2026-10-22", 10],
      ["2026-10-23", 2],
      ["2026-10-30", 10],
    ]);
    assert.deepEqual(streakFrom(counts, "2026-10-31", goal), {
      current: 1,
      best: 3,
      todayDone: false,
    });
  });

  it("is zero with no history", () => {
    assert.equal(streakFrom(new Map(), "2026-10-31", goal).current, 0);
  });
});

describe("lastSevenDays", () => {
  it("lists the week ending today, oldest first", () => {
    const week = lastSevenDays(new Map([["2026-10-31", 25]]), "2026-10-31", 20);
    assert.equal(week.length, 7);
    assert.equal(week[0].day, "2026-10-25");
    assert.equal(week[6].letter, "S");
    assert.equal(week[6].isToday, true);
    assert.equal(week[6].met, true);
    assert.equal(week[5].met, false);
  });
});
