"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { SpeakIcon } from "@/components/icons";
import { speakableText } from "@/lib/speakable";
import { pickVoice } from "@/lib/voices";

// --- The device's own voice --------------------------------------------------

function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** The device's voices. Chrome fills the list only after it is first asked for, so the button asks early. */
function deviceVoices(): SpeechSynthesisVoice[] {
  return canSpeak() ? window.speechSynthesis.getVoices() : [];
}

/** Failures worth a second try on a voice stored on the device; not a cancel or a newer word cutting in. */
const VOICE_FAILURES = new Set(["network", "synthesis-unavailable", "synthesis-failed", "voice-unavailable"]);

/** Say `text` with the most natural voice the device has, rather than its default. */
function sayAloud(text: string) {
  if (!canSpeak()) return;
  const say = (voice: SpeechSynthesisVoice | null, retry: boolean) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang ?? "en-US";
    if (voice) utterance.voice = voice;
    // Online voices need a connection. Without one, say it again offline.
    if (retry && voice && !voice.localService) {
      utterance.onerror = (event) => {
        if (VOICE_FAILURES.has(event.error)) say(pickVoice(deviceVoices(), { localOnly: true }), false);
      };
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };
  say(pickVoice(deviceVoices()), true);
}

// --- The AI voice's clips ----------------------------------------------------

/**
 * Clips already played on this visit, by text. A word is fetched on its first
 * tap only: every later tap, on any card or in the word sheet, replays it from
 * memory until the page is closed. Most recently heard last.
 */
const clips = new Map<string, HTMLAudioElement>();
/** Plenty for a long session: each is about a second of sound, some 50 KB. */
const MAX_CLIPS = 60;

function keep(text: string, audio: HTMLAudioElement) {
  clips.delete(text);
  clips.set(text, audio);
  if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value as string);
}

/** How long a first tap waits for a new clip before the device speaks instead. */
const WAIT_MS = 10_000;

const noSubscribe = () => () => {};

/** For a speaker on a card's paper face. */
export const cardSpeaker =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#efeafe] text-[#5b4bb0] transition hover:bg-[#e4dcfd] active:scale-95 disabled:opacity-60";

/**
 * A button that reads `text` aloud. With `aiVoice`, it plays the AI voice's
 * clip: the first tap asks the server for it (a few seconds when the word is
 * new, since it is made then and saved), later taps replay it from memory.
 * When there is no clip -- no AI voice, text it will not read, the free
 * allowance used up -- `recording` plays if given, otherwise the device's
 * best voice speaks.
 *
 * Sound is started inside the tap itself, which phones insist on.
 */
export function SpeakerButton({
  text,
  aiVoice,
  recording = null,
  className,
}: {
  text: string;
  aiVoice: boolean;
  /** A recording of the word to fall back on, e.g. the dictionary's. */
  recording?: string | null;
  className: string;
}) {
  const [loading, setLoading] = useState(false);
  /** A clip still on its way from the server. */
  const pending = useRef<HTMLAudioElement | null>(null);
  // The server cannot tell whether the device can speak, so this is false until the page is live.
  const deviceCanSpeak = useSyncExternalStore(noSubscribe, canSpeak, () => false);

  // Load the device's voice list now, so the best voice is known by the first tap.
  // A clip still on its way when the button goes (the sheet closes, the card moves
  // on) is dropped, so it never speaks over whatever comes next.
  useEffect(() => {
    deviceVoices();
    return () => {
      pending.current?.pause();
      pending.current = null;
    };
  }, [text]);

  if (!aiVoice && !recording && !deviceCanSpeak) return null;

  function fallback() {
    if (recording) void new Audio(recording).play().catch(() => sayAloud(text));
    else sayAloud(text);
  }

  function speak() {
    const words = aiVoice ? speakableText(text) : null;
    if (!words) {
      fallback();
      return;
    }

    const saved = clips.get(words);
    if (saved) {
      keep(words, saved);
      saved.currentTime = 0;
      saved.play().catch(() => {
        clips.delete(words);
        fallback();
      });
      return;
    }

    const audio = new Audio(`/api/speech?text=${encodeURIComponent(words)}`);
    pending.current = audio;
    let settled = false;
    const settle = (played: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setLoading(false);
      // The button went away or moved to another word: this clip is not wanted.
      if (pending.current !== audio) return;
      pending.current = null;
      if (played) {
        keep(words, audio);
      } else {
        audio.pause();
        fallback();
      }
    };
    const timer = window.setTimeout(() => settle(false), WAIT_MS);
    audio.addEventListener("playing", () => settle(true), { once: true });
    audio.addEventListener("error", () => settle(false), { once: true });
    setLoading(true);
    audio.play().catch(() => settle(false));
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={`Hear “${text}”`}
      aria-busy={loading}
      disabled={loading}
      onClick={speak}
    >
      <SpeakIcon className={`h-5 w-5 ${loading ? "animate-pulse" : ""}`} />
    </button>
  );
}
