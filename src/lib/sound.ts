import { multiplierFor } from "@/lib/game";

/**
 * The rules behind the sound effects, apart from the audio itself so they can
 * be tested without a browser. The audio lives in components/game/sound.ts.
 */

/** The sound packs, in the order the menu lists them. */
export const SOUND_PACKS = [
  { id: "arcade", name: "Arcade", detail: "Chiptune blips" },
  { id: "bubbly", name: "Bubbly", detail: "Soft pops and plucks" },
  { id: "crisp", name: "Crisp", detail: "Quiet clicks and bells" },
] as const;

export type SoundPack = (typeof SOUND_PACKS)[number]["id"];
export type SoundSetting = SoundPack | "off";

export const DEFAULT_SOUND: SoundSetting = "arcade";

export function isSoundSetting(value: unknown): value is SoundSetting {
  return value === "off" || SOUND_PACKS.some((pack) => pack.id === value);
}

/** Major pentatonic steps in semitones. A run of answers climbs this scale. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/**
 * How many semitones above its base note the nth answer in a row sounds. Any
 * pentatonic note sounds fine next to any other, so the climb never jars, and
 * it stops two octaves up.
 */
export function pitchStep(inARow: number): number {
  const n = Number.isFinite(inARow) ? Math.floor(inARow) : 1;
  return PENTATONIC[Math.min(Math.max(n, 1), PENTATONIC.length) - 1];
}

/** True when this answer lifted the combo to a new multiplier: x1.5 at 3, x2 at 6. */
export function reachedNewTier(inARow: number): boolean {
  return inARow > 1 && multiplierFor(inARow) > multiplierFor(inARow - 1);
}

/** The Blitz clock ticks out loud for its last this-many seconds. */
export const COUNTDOWN_SECONDS = 5;

/**
 * The second to tick for, or null. It is the whole second the clock shows,
 * once per second, only in the countdown, and never at zero (that is the
 * end-of-round sound instead).
 */
export function countdownTick(msLeft: number, lastTicked: number | null): number | null {
  if (!(msLeft > 0)) return null;
  const second = Math.ceil(msLeft / 1000);
  if (second > COUNTDOWN_SECONDS || second === lastTicked) return null;
  return second;
}
