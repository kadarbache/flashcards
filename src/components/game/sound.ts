"use client";

import { useCallback, useRef } from "react";

import type { Direction, SwipeFrame } from "@/components/game/use-swipe";
import {
  DEFAULT_SOUND,
  isSoundSetting,
  pitchStep,
  type SoundPack,
  type SoundSetting,
} from "@/lib/sound";

/**
 * Sound effects, synthesised on the spot with the Web Audio API. There are no
 * audio files to download or cache, so they add nothing to the install and
 * work offline.
 *
 * Every sound is a short recipe of notes. A pack decides what a note sounds
 * like (square-wave blips, marimba plucks or glassy bells); the recipes are
 * shared, so each pack plays the same tune in its own voice.
 *
 * Browsers only start audio after a tap or key press on the page. Sounds asked
 * for before that are dropped rather than saved up. On an iPhone the silent
 * switch mutes them, like any game.
 */

export type SoundEvent =
  | "flip"
  | "arm"
  | "again"
  | "hard"
  | "good"
  | "easy"
  | "undo"
  | "skip"
  | "combo"
  | "level"
  | "goal"
  | "clear"
  | "next"
  | "back"
  | "right"
  | "wrong"
  | "clock"
  | "over"
  | "best"
  | "tap";

const STORAGE_KEY = "flashcards:sound";
const VOLUME = 0.6;

// The setting: one value per device, in localStorage, shared by every tab.

let setting: SoundSetting | null = null;
const listeners = new Set<() => void>();

function readSetting(): SoundSetting {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isSoundSetting(saved) ? saved : DEFAULT_SOUND;
  } catch {
    // Storage can be blocked (private mode, settings). Fall back to the default.
    return DEFAULT_SOUND;
  }
}

export function getSoundSetting(): SoundSetting {
  if (setting === null) setting = readSetting();
  return setting;
}

/** What the server renders. The real setting arrives once the page hydrates. */
export function getServerSoundSetting(): SoundSetting {
  return DEFAULT_SOUND;
}

export function setSoundSetting(next: SoundSetting): void {
  setting = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not saved for next time, but it still applies to this visit.
  }
  for (const listener of listeners) listener();
}

export function subscribeSoundSetting(listener: () => void): () => void {
  listeners.add(listener);
  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return;
    setting = null;
    listener();
  }
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// The audio graph: one context and one volume control for the whole app.

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Context =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    context = new Context();
    master = context.createGain();
    master.gain.value = VOLUME;
    master.connect(context.destination);
  }
  // "suspended" before the first tap, "interrupted" on iOS after a call.
  if (context.state !== "running") context.resume().catch(() => {});
  return context;
}

/** Whether the page is inside a tap or key press right now, where audio may start. */
function inGesture(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  return activation ? activation.isActive : true;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Silence, a quick rise to `peak`, then a fade back to silence. */
function envelope(gain: GainNode, at: number, attack: number, decay: number, peak: number) {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  /** Glide to this frequency over the tone's length. */
  to?: number;
  dur?: number;
  vol?: number;
  attack?: number;
  lowpass?: number;
}

function tone(at: number, options: ToneOptions) {
  if (!context || !master) return;
  const { type = "sine", freq, to, dur = 0.15, vol = 0.2, attack = 0.004, lowpass } = options;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, at);
  if (to) oscillator.frequency.exponentialRampToValueAtTime(to, at + dur);
  let node: AudioNode = oscillator;
  if (lowpass) {
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    oscillator.connect(filter);
    node = filter;
  }
  node.connect(gain);
  gain.connect(master);
  envelope(gain, at, attack, dur, vol);
  oscillator.start(at);
  oscillator.stop(at + attack + dur + 0.05);
}

interface NoiseOptions {
  type?: BiquadFilterType;
  freq: number;
  to?: number;
  dur?: number;
  vol?: number;
  q?: number;
}

function noise(at: number, options: NoiseOptions) {
  if (!context || !master) return;
  const { type = "bandpass", freq, to, dur = 0.1, vol = 0.1, q = 1 } = options;
  if (!noiseBuffer) {
    noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, at);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, at + dur);
  const gain = context.createGain();
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  envelope(gain, at, 0.003, dur, vol);
  source.start(at);
  source.stop(at + dur + 0.05);
}

/** A bell: one sine wave wobbling another, fading to a pure tone. */
function bell(at: number, freq: number, dur = 0.6, vol = 0.1, ratio = 3.5, depth = 1.5) {
  if (!context || !master) return;
  const carrier = context.createOscillator();
  const modulator = context.createOscillator();
  const wobble = context.createGain();
  const gain = context.createGain();
  carrier.frequency.value = freq;
  modulator.frequency.value = freq * ratio;
  wobble.gain.setValueAtTime(freq * depth, at);
  wobble.gain.exponentialRampToValueAtTime(1, at + dur);
  modulator.connect(wobble);
  wobble.connect(carrier.frequency);
  carrier.connect(gain);
  gain.connect(master);
  envelope(gain, at, 0.002, dur, vol);
  carrier.start(at);
  modulator.start(at);
  carrier.stop(at + dur + 0.05);
  modulator.stop(at + dur + 0.05);
}

/** What one pack sounds like. The recipes below only ever call these. */
interface Voice {
  /** A pitched note. `level` scales its volume, `length` its duration. */
  note(at: number, midi: number, level?: number, length?: number): void;
  flip(at: number): void;
  tick(at: number, high?: boolean): void;
  sweep(at: number, up: boolean): void;
  whoosh(at: number, forward: boolean): void;
  thud(at: number): void;
  sparkle(at: number): void;
  chord(at: number, notes: number[]): void;
}

const VOICES: Record<SoundPack, Voice> = {
  arcade: {
    note: (at, midi, level = 1, length = 1) =>
      tone(at, { type: "square", freq: hz(midi), dur: 0.09 * length, vol: 0.07 * level, lowpass: 3500 }),
    flip: (at) => tone(at, { type: "square", freq: 500, to: 1000, dur: 0.05, vol: 0.06, lowpass: 4000 }),
    tick: (at, high) =>
      tone(at, { type: "square", freq: high ? 1800 : 1200, dur: 0.015, vol: 0.04, lowpass: 5000 }),
    sweep: (at, up) =>
      tone(at, { type: "square", freq: up ? 300 : 900, to: up ? 900 : 300, dur: 0.14, vol: 0.06, lowpass: 3000 }),
    whoosh: (at, forward) =>
      noise(at, { freq: forward ? 600 : 2400, to: forward ? 2400 : 600, dur: 0.16, vol: 0.14, q: 0.8 }),
    thud: (at) => tone(at, { type: "square", freq: 150, to: 70, dur: 0.22, vol: 0.08, lowpass: 900 }),
    sparkle: (at) =>
      [96, 100, 103].forEach((midi, i) =>
        tone(at + i * 0.035, { type: "triangle", freq: hz(midi), dur: 0.05, vol: 0.05 }),
      ),
    chord: (at, notes) =>
      notes.forEach((midi) => tone(at, { type: "triangle", freq: hz(midi), dur: 0.5, vol: 0.06, attack: 0.01 })),
  },
  bubbly: {
    note: (at, midi, level = 1, length = 1) => {
      tone(at, { freq: hz(midi), dur: 0.3 * length, vol: 0.22 * level, attack: 0.003 });
      tone(at, { freq: hz(midi) * 4, dur: 0.05, vol: 0.04 * level, attack: 0.002 });
    },
    flip: (at) => {
      tone(at, { freq: 280, to: 720, dur: 0.07, vol: 0.2 });
      noise(at, { freq: 3000, dur: 0.02, vol: 0.03 });
    },
    tick: (at, high) => tone(at, { freq: high ? 1400 : 1000, dur: 0.025, vol: 0.07 }),
    sweep: (at, up) => tone(at, { freq: up ? 300 : 800, to: up ? 800 : 300, dur: 0.18, vol: 0.18 }),
    whoosh: (at, forward) =>
      noise(at, { type: "lowpass", freq: forward ? 500 : 1800, to: forward ? 1800 : 500, dur: 0.2, vol: 0.16, q: 0.7 }),
    thud: (at) => {
      tone(at, { freq: 220, to: 110, dur: 0.2, vol: 0.25 });
      tone(at, { type: "triangle", freq: 110, dur: 0.12, vol: 0.06 });
    },
    sparkle: (at) =>
      [91, 95, 98].forEach((midi, i) => tone(at + i * 0.04, { freq: hz(midi), dur: 0.12, vol: 0.05 })),
    chord: (at, notes) =>
      notes.forEach((midi) => tone(at, { freq: hz(midi), dur: 0.9, vol: 0.07, attack: 0.05 })),
  },
  crisp: {
    note: (at, midi, level = 1, length = 1) => bell(at, hz(midi), 0.5 * length, 0.1 * level),
    flip: (at) => {
      noise(at, { freq: 3500, dur: 0.025, vol: 0.12, q: 1.5 });
      noise(at + 0.01, { freq: 1200, dur: 0.04, vol: 0.05 });
    },
    tick: (at, high) => noise(at, { freq: high ? 6000 : 4000, dur: 0.012, vol: 0.08, q: 2 }),
    sweep: (at, up) => tone(at, { freq: up ? 500 : 1200, to: up ? 1200 : 500, dur: 0.12, vol: 0.07 }),
    whoosh: (at, forward) =>
      noise(at, { freq: forward ? 1500 : 5000, to: forward ? 5000 : 1500, dur: 0.18, vol: 0.07, q: 0.5 }),
    thud: (at) => {
      tone(at, { freq: 90, to: 60, dur: 0.16, vol: 0.25 });
      noise(at, { type: "lowpass", freq: 400, dur: 0.05, vol: 0.08 });
    },
    sparkle: (at) => {
      bell(at, hz(96), 0.3, 0.04, 7, 1);
      bell(at + 0.05, hz(103), 0.3, 0.03, 7, 1);
    },
    chord: (at, notes) => notes.forEach((midi) => bell(at, hz(midi), 1, 0.05)),
  },
};

const arpeggio = (voice: Voice, at: number, notes: number[], gap: number, level = 1) =>
  notes.forEach((midi, i) => voice.note(at + i * gap, midi, level));

/**
 * The tunes, as MIDI note numbers (60 is middle C). `n` is the answer count in
 * a row for the grades and Blitz, which lifts their pitch as a run builds.
 * "Again" falls gently on purpose: forgetting is part of learning a card, so
 * it should not sound like losing.
 */
const RECIPES: Record<SoundEvent, (voice: Voice, at: number, n: number) => void> = {
  flip: (v, at) => v.flip(at),
  arm: (v, at) => v.tick(at),
  again: (v, at) => {
    v.note(at, 64, 0.8);
    v.note(at + 0.1, 60, 0.7, 1.3);
  },
  hard: (v, at) => {
    v.note(at, 65, 0.8);
    v.note(at + 0.1, 67, 0.7);
  },
  good: (v, at, n) => {
    const s = pitchStep(n);
    v.note(at, 72 + s);
    v.note(at + 0.07, 79 + s, 0.8);
  },
  easy: (v, at, n) => {
    const s = pitchStep(n);
    v.note(at, 76 + s);
    v.note(at + 0.06, 79 + s);
    v.note(at + 0.12, 84 + s, 0.9, 1.4);
    v.sparkle(at + 0.16);
  },
  undo: (v, at) => v.sweep(at, false),
  skip: (v, at) => {
    v.note(at, 76, 0.5, 0.6);
    v.note(at + 0.06, 72, 0.4, 0.6);
  },
  combo: (v, at) => {
    arpeggio(v, at, [72, 76, 79, 84, 88], 0.05, 0.7);
    v.sparkle(at + 0.26);
  },
  level: (v, at) => {
    arpeggio(v, at, [72, 76, 79, 84], 0.09, 0.9);
    v.chord(at + 0.36, [84, 88, 91]);
    v.sparkle(at + 0.4);
  },
  goal: (v, at) => {
    v.note(at, 79, 1, 1.5);
    v.note(at + 0.13, 84, 1, 2);
    v.sparkle(at + 0.2);
  },
  clear: (v, at) => {
    const tune: Array<[number, number]> = [
      [0, 72], [0.1, 74], [0.2, 76], [0.3, 79], [0.45, 76], [0.55, 79], [0.7, 84],
    ];
    for (const [offset, midi] of tune) v.note(at + offset, midi, 0.9);
    v.chord(at + 0.7, [72, 76, 79, 84]);
  },
  next: (v, at) => v.whoosh(at, true),
  back: (v, at) => v.whoosh(at, false),
  right: (v, at, n) => {
    const s = pitchStep(n);
    v.note(at, 76 + s);
    v.note(at + 0.06, 83 + s, 0.7);
  },
  wrong: (v, at) => {
    v.thud(at);
    arpeggio(v, at + 0.12, [67, 64, 60], 0.11, 0.8);
  },
  clock: (v, at) => v.tick(at, true),
  over: (v, at) => {
    arpeggio(v, at, [72, 67, 64], 0.12);
    v.note(at + 0.36, 60, 1, 2);
  },
  best: (v, at) => {
    RECIPES.level(v, at, 1);
    arpeggio(v, at + 0.8, [84, 88, 91, 96], 0.07, 0.8);
    v.sparkle(at + 1.1);
  },
  tap: (v, at) => v.tick(at),
};

/**
 * Play a sound in the chosen pack, unless sound is off. `inARow` lifts the
 * grade and Blitz sounds as a run builds; `delayMs` lines one sound up after
 * another.
 */
export function play(event: SoundEvent, inARow = 1, delayMs = 0, pack?: SoundPack): void {
  const chosen = pack ?? getSoundSetting();
  if (chosen === "off") return;
  const ctx = audio();
  if (!ctx) return;
  // Before the first tap the audio cannot start yet. Anything scheduled now
  // would all burst out at once later, so drop it instead.
  if (ctx.state !== "running" && !inGesture()) return;
  try {
    RECIPES[event](VOICES[chosen], ctx.currentTime + 0.01 + delayMs / 1000, inARow);
  } catch {
    // A sound effect must never break the game.
  }
}

/**
 * A tick the moment a dragged card passes the point where letting go counts,
 * and again if it swings round to another answer while past it.
 */
export function useArmSound(): (frame: SwipeFrame) => void {
  const armed = useRef<Direction | null>(null);
  return useCallback((frame: SwipeFrame) => {
    const next = frame.progress >= 1 ? frame.direction : null;
    if (next === armed.current) return;
    armed.current = next;
    if (next) play("arm");
  }, []);
}
