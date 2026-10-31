import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countdownTick,
  DEFAULT_SOUND,
  isSoundSetting,
  pitchStep,
  reachedNewTier,
  SOUND_PACKS,
} from "@/lib/sound";

describe("sound settings", () => {
  it("accepts every pack and off, nothing else", () => {
    for (const pack of SOUND_PACKS) assert.equal(isSoundSetting(pack.id), true);
    assert.equal(isSoundSetting("off"), true);
    assert.equal(isSoundSetting("loud"), false);
    assert.equal(isSoundSetting(null), false);
    assert.equal(isSoundSetting(undefined), false);
  });

  it("starts with a pack, not silence", () => {
    assert.notEqual(DEFAULT_SOUND, "off");
    assert.equal(isSoundSetting(DEFAULT_SOUND), true);
  });
});

describe("pitchStep", () => {
  it("climbs the pentatonic scale with each answer in a row", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6].map(pitchStep),
      [0, 2, 4, 7, 9, 12],
    );
  });

  it("stops two octaves up however long the run", () => {
    assert.equal(pitchStep(11), 24);
    assert.equal(pitchStep(500), 24);
  });

  it("treats nonsense as the first answer", () => {
    assert.equal(pitchStep(0), 0);
    assert.equal(pitchStep(-3), 0);
    assert.equal(pitchStep(Number.NaN), 0);
  });
});

describe("reachedNewTier", () => {
  it("fires on the answers that raise the multiplier", () => {
    const tiers = [1, 2, 3, 4, 5, 6, 7, 12].filter(reachedNewTier);
    assert.deepEqual(tiers, [3, 6]);
  });
});

describe("countdownTick", () => {
  it("stays quiet before the last five seconds", () => {
    assert.equal(countdownTick(30_000, null), null);
    assert.equal(countdownTick(5_001, null), null);
  });

  it("ticks once per second inside the countdown", () => {
    assert.equal(countdownTick(5_000, null), 5);
    assert.equal(countdownTick(4_950, 5), null);
    assert.equal(countdownTick(4_000, 5), 4);
    assert.equal(countdownTick(120, 2), 1);
  });

  it("leaves zero to the end-of-round sound", () => {
    assert.equal(countdownTick(0, 1), null);
    assert.equal(countdownTick(-50, 1), null);
    assert.equal(countdownTick(Number.NaN, null), null);
  });
});
