"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { createClipPlayer, type Attempt } from "@/components/clip-player";
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

/** One for the whole page, so a word heard on a card replays at once in the word sheet, and the other way round. */
const player = createClipPlayer({ load: (url) => new Audio(url) });

const noSubscribe = () => () => {};

/** For a speaker on a card's paper face. */
export const cardSpeaker =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#efeafe] text-[#5b4bb0] transition hover:bg-[#e4dcfd] active:scale-95 disabled:opacity-60";

/**
 * A button that reads `text` aloud. With `aiVoice`, it plays the AI voice's
 * clip: the first tap asks the server for it (a few seconds when the word is
 * new), later taps replay it from memory without asking again. When there is no clip -- no AI voice, text it will
 * not read, the free allowance used up -- `recording` plays if given,
 * otherwise the device's best voice speaks.
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
  /** A tap still waiting for its clip. */
  const pending = useRef<Attempt | null>(null);
  // The server cannot tell whether the device can speak, so this is false until the page is live.
  const deviceCanSpeak = useSyncExternalStore(noSubscribe, canSpeak, () => false);

  // Load the device's voice list now, so the best voice is known by the first tap.
  // When the button goes (the sheet closes, the card moves on), a clip it is still
  // waiting for stays silent, so it never speaks over whatever comes next.
  useEffect(() => {
    deviceVoices();
    return () => {
      pending.current?.stop();
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

    const attempt = player.play(words);
    if (attempt.waiting) {
      pending.current = attempt;
      setLoading(true);
    }
    void attempt.result.then((outcome) => {
      if (pending.current === attempt) pending.current = null;
      if (attempt.waiting) setLoading(false);
      if (outcome === "failed") fallback();
    });
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
