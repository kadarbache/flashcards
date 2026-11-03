"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { addWordToDeck, defineWord, removeWordFromDeck } from "@/app/watch/actions";
import { play } from "@/components/game/sound";
import { CheckIcon, CloseIcon, MinusIcon, PlusIcon, SpeakIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { field, iconButton, label, primaryButton } from "@/components/ui";
import type { DictionaryEntry, LookupOutcome } from "@/lib/dictionary";
import { findSavedCards, type SavedCard } from "@/lib/transcript";
import { pickVoice } from "@/lib/voices";

export interface DeckOption {
  id: string;
  name: string;
}

export interface WordPick {
  /** Changes with every click, so the same word clicked twice still starts fresh. */
  id: number;
  /** What was clicked or selected: a word, or a short phrase. */
  word: string;
  /** The transcript line it came from, which becomes the card's example. */
  sentence: string;
}

const DECK_KEY = "watch-deck";

/** Red, for taking a card away. Not gold: it should not look like the thing to do. */
const removeButton =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-again/40 bg-again/10 px-5 text-base font-bold text-again transition hover:bg-again/20 active:scale-[0.97] disabled:opacity-50";

function rememberedDeck(decks: DeckOption[]): string {
  try {
    const saved = window.localStorage.getItem(DECK_KEY);
    if (saved && decks.some((deck) => deck.id === saved)) return saved;
  } catch {
    // Storage can be off; the first deck will do.
  }
  return decks[0]?.id ?? "";
}

function rememberDeck(id: string): void {
  try {
    window.localStorage.setItem(DECK_KEY, id);
  } catch {
    // Not worth bothering anyone about.
  }
}

/** Answers already asked for, by word and line. A word tapped again opens at once and costs nothing. */
const answers = new Map<string, Promise<LookupOutcome>>();
const MAX_ANSWERS = 50;

/**
 * One request per word and line, however often it is asked for. React runs
 * the sheet's effect twice in development, which would otherwise pay twice.
 * A failure is forgotten so the next tap tries again.
 */
function lookUp(word: string, sentence: string): Promise<LookupOutcome> {
  const key = `${word}\n${sentence}`;
  const known = answers.get(key);
  if (known) return known;

  const asked = defineWord(word, sentence);
  answers.set(key, asked);
  if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value as string);
  const forget = () => answers.delete(key);
  asked.then((outcome) => !outcome.ok && outcome.reason === "failed" && forget(), forget);
  return asked;
}

function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** The device's voices. Chrome fills the list only after it is first asked for, so the sheet asks early. */
function deviceVoices(): SpeechSynthesisVoice[] {
  return canSpeak() ? window.speechSynthesis.getVoices() : [];
}

/** Failures worth a second try on a voice stored on the device; not a cancel or a newer word cutting in. */
const VOICE_FAILURES = new Set(["network", "synthesis-unavailable", "synthesis-failed", "voice-unavailable"]);

/** Say a word with the most natural voice the device has, rather than its default. */
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

/** The dictionary's recording when there is one, the device's best voice otherwise. */
function pronounce(entry: DictionaryEntry) {
  if (entry.audio) void new Audio(entry.audio).play().catch(() => sayAloud(entry.word));
  else sayAloud(entry.word);
}

/** A definition as the back of a card: "(verb) to move fast on foot", the label style the app already reads. */
function cardBack(partOfSpeech: string, definition: string): string {
  return partOfSpeech && partOfSpeech !== "word" ? `(${partOfSpeech}) ${definition}` : definition;
}

/**
 * The sheet that opens on a word: what it means, and a way to keep it, or to
 * take it back out when a deck already has it.
 *
 * Every field is editable before saving -- the dictionary's first definition
 * is a starting point, not always the meaning the video used.
 */
export function WordSheet({
  pick,
  decks,
  saved,
  aiVoice,
  onClose,
  onAdded,
  onRemoved,
}: {
  pick: WordPick | null;
  decks: DeckOption[];
  /** Every card in every deck, to tell whether the word is saved already. */
  saved: SavedCard[];
  /** Read words aloud with the AI voice, falling back to the device's. */
  aiVoice: boolean;
  onClose: () => void;
  onAdded: (card: SavedCard) => void;
  onRemoved: (cardId: string) => void;
}) {
  return (
    <Sheet open={pick !== null} onClose={onClose} label={pick ? `Meaning of ${pick.word}` : "Word"}>
      {pick && (
        <SheetBody
          key={pick.id}
          pick={pick}
          decks={decks}
          saved={saved}
          aiVoice={aiVoice}
          onClose={onClose}
          onAdded={onAdded}
          onRemoved={onRemoved}
        />
      )}
    </Sheet>
  );
}

function SheetBody({
  pick,
  decks,
  saved,
  aiVoice,
  onClose,
  onAdded,
  onRemoved,
}: {
  pick: WordPick;
  decks: DeckOption[];
  saved: SavedCard[];
  aiVoice: boolean;
  onClose: () => void;
  onAdded: (card: SavedCard) => void;
  onRemoved: (cardId: string) => void;
}) {
  const [lookup, setLookup] = useState<LookupOutcome | null>(null);
  const [front, setFront] = useState(pick.word);
  const [back, setBack] = useState("");
  const [example, setExample] = useState(pick.sentence);
  const [lastDeck] = useState(() => rememberedDeck(decks));
  const [chosenDeck, setChosenDeck] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [voiceLoading, setVoiceLoading] = useState(false);
  const clip = useRef<HTMLAudioElement | null>(null);

  // Start the voice list loading now, so the best voice is known by the time the speaker is tapped.
  // A clip still loading when the sheet closes is stopped, so it does not speak over the video.
  useEffect(() => {
    deviceVoices();
    return () => {
      clip.current?.pause();
      clip.current = null;
    };
  }, []);

  /**
   * The AI voice's clip for the word, made on the first tap (a few seconds)
   * and saved, so every later tap plays at once. When there is no clip --
   * no key, the free allowance used up, Google down -- the device speaks.
   * The clip is started inside the tap itself, which phones insist on.
   */
  function hear(entry: DictionaryEntry) {
    if (!aiVoice) {
      pronounce(entry);
      return;
    }
    clip.current?.pause();
    const audio = new Audio(`/api/speech?text=${encodeURIComponent(entry.word)}`);
    clip.current = audio;

    let settled = false;
    const settle = (played: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      // A newer tap, or a closed sheet, owns the speaker now.
      if (clip.current !== audio) return;
      setVoiceLoading(false);
      if (!played) {
        clip.current = null;
        pronounce(entry);
      }
    };
    const timer = window.setTimeout(() => {
      audio.pause();
      settle(false);
    }, 10_000);
    audio.addEventListener("playing", () => settle(true), { once: true });
    audio.addEventListener("error", () => settle(false), { once: true });
    setVoiceLoading(true);
    audio.play().catch(() => settle(false));
  }

  useEffect(() => {
    let cancelled = false;
    lookUp(pick.word, pick.sentence)
      .then((outcome) => {
        if (cancelled) return;
        setLookup(outcome);
        if (outcome.ok) {
          setFront(outcome.entry.word);
          const first = outcome.entry.meanings[0];
          setBack(cardBack(first.partOfSpeech, first.definitions[0].definition));
        }
      })
      .catch(() => {
        if (!cancelled) setLookup({ ok: false, reason: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [pick.word, pick.sentence]);

  const entry: DictionaryEntry | null = lookup?.ok ? lookup.entry : null;

  // Cards for the tapped word, and for its dictionary form once the lookup
  // says what that is: a tapped "running" finds a card saved as "run".
  const matches = useMemo(
    () =>
      findSavedCards(saved, entry ? [pick.word, entry.word] : [pick.word]).filter((card) =>
        decks.some((deck) => deck.id === card.deckId),
      ),
    [saved, decks, pick.word, entry],
  );
  // A deck that has the word already comes up first, so the sheet says so at once.
  const deckId = chosenDeck ?? matches[0]?.deckId ?? lastDeck;
  const savedHere = matches.find((card) => card.deckId === deckId) ?? null;
  const deckName = (id: string) => decks.find((deck) => deck.id === id)?.name ?? "another deck";
  const otherDecks = [...new Set(matches.filter((card) => card.deckId !== deckId).map((card) => card.deckId))];

  function finish(text: string) {
    setDone(text);
    window.setTimeout(onClose, 900);
  }

  async function save() {
    if (busy || !deckId) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await addWordToDeck({ deckId, front, back, example });
      if (outcome.ok) {
        play("good");
        rememberDeck(deckId);
        onAdded(outcome.card);
        finish(outcome.message);
      } else {
        setError(outcome.message);
      }
    } catch {
      setError("That could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: SavedCard) {
    if (busy) return;
    const question = `Remove “${card.front}” from ${deckName(card.deckId)}? Its review history goes with it.`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await removeWordFromDeck(card.id);
      onRemoved(card.id);
      finish(outcome.message);
    } catch {
      setError("That could not be removed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold tracking-wide text-gold uppercase">From the video</p>
          <h2 className="text-3xl font-extrabold tracking-tight break-words">{entry?.word ?? pick.word}</h2>
          {entry?.phonetic && <p className="text-ink-muted">{entry.phonetic}</p>}
        </div>
        {entry && (aiVoice || entry.audio || canSpeak()) && (
          <button
            type="button"
            className={iconButton}
            aria-label={`Hear “${entry.word}”`}
            aria-busy={voiceLoading}
            disabled={voiceLoading}
            onClick={() => hear(entry)}
          >
            <SpeakIcon className={`h-5 w-5 ${voiceLoading ? "animate-pulse text-gold" : ""}`} />
          </button>
        )}
        <button type="button" className={iconButton} aria-label="Close" onClick={onClose}>
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      <Meanings lookup={lookup} word={pick.word} selected={back} onSelect={setBack} />

      {done ? (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-surface-high p-4 font-bold text-good">
          <CheckIcon className="h-5 w-5" />
          {done}
        </p>
      ) : decks.length === 0 ? (
        <p className="rounded-2xl bg-surface-high p-4 text-sm">
          Make a deck first, then come back to add words to it.{" "}
          <Link href="/" className="font-bold text-gold hover:underline">
            Go to your decks
          </Link>
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!savedHere) void save();
          }}
        >
          <div className={`grid grid-cols-1 gap-3 ${savedHere ? "" : "sm:grid-cols-[1fr_1.2fr]"}`}>
            {!savedHere && (
              <div>
                <label className={label} htmlFor="word-front">
                  Word
                </label>
                <input
                  id="word-front"
                  className={field}
                  value={front}
                  onChange={(event) => setFront(event.target.value)}
                  autoComplete="off"
                />
              </div>
            )}
            <div>
              <label className={label} htmlFor="word-deck">
                Deck
              </label>
              <select
                id="word-deck"
                className={field}
                value={deckId}
                onChange={(event) => {
                  setChosenDeck(event.target.value);
                  setError(null);
                }}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {savedHere ? (
            <div className="rounded-2xl border border-gold/40 bg-[#2b2614] p-4">
              <p className="flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-gold uppercase">
                <CheckIcon className="h-4 w-4" />
                Already in {deckName(savedHere.deckId)}
              </p>
              <p className="mt-2 font-bold break-words">{savedHere.front}</p>
              <p className="text-sm break-words text-ink-muted">{savedHere.back}</p>
            </div>
          ) : (
            <>
              <div>
                <label className={label} htmlFor="word-back">
                  Meaning
                </label>
                <textarea
                  id="word-back"
                  className={`${field} min-h-20`}
                  value={back}
                  onChange={(event) => setBack(event.target.value)}
                  placeholder="Write what it means"
                  rows={2}
                />
              </div>
              <div>
                <label className={label} htmlFor="word-example">
                  Example
                </label>
                <textarea
                  id="word-example"
                  className={`${field} min-h-24 text-sm italic`}
                  value={example}
                  onChange={(event) => setExample(event.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}

          {otherDecks.length > 0 && (
            <p className="text-sm text-ink-muted">
              {savedHere ? "Also in" : "Already in"} {otherDecks.map(deckName).join(", ")}.
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm font-bold text-again">
              {error}
            </p>
          )}

          {savedHere ? (
            <button type="button" className={removeButton} disabled={busy} onClick={() => void remove(savedHere)}>
              <MinusIcon className="h-5 w-5" />
              {busy ? "Removing…" : "Remove from deck"}
            </button>
          ) : (
            <button
              type="submit"
              className={`${primaryButton} w-full`}
              disabled={busy || front.trim() === "" || back.trim() === ""}
            >
              <PlusIcon className="h-5 w-5" />
              {busy ? "Adding…" : "Add to deck"}
            </button>
          )}
        </form>
      )}
    </div>
  );
}

/** The dictionary's answer. Tapping a definition puts it in the Meaning box. */
function Meanings({
  lookup,
  word,
  selected,
  onSelect,
}: {
  lookup: LookupOutcome | null;
  word: string;
  selected: string;
  onSelect: (back: string) => void;
}) {
  if (!lookup) {
    return (
      <div className="space-y-2" aria-label="Looking it up">
        <div className="h-4 w-24 animate-pulse rounded-full bg-surface-high" />
        <div className="h-14 animate-pulse rounded-2xl bg-surface-high" />
        <div className="h-14 animate-pulse rounded-2xl bg-surface-high" />
      </div>
    );
  }
  if (!lookup.ok) {
    return (
      <p className="rounded-2xl bg-surface-high p-4 text-sm text-ink-muted">
        {lookup.reason === "not-found"
          ? `The dictionary has nothing for “${word}”. Write the meaning yourself below.`
          : "The dictionary could not be reached. Write the meaning yourself, or try again in a moment."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {lookup.entry.meanings.map((meaning, index) => (
        <section key={`${index}-${meaning.partOfSpeech}`} className="space-y-2">
          <h3 className="text-xs font-extrabold tracking-wide text-ink-muted uppercase">
            {meaning.partOfSpeech}
            {lookup.entry.inContext && " · in this sentence"}
          </h3>
          <ul className="space-y-2">
            {meaning.definitions.map((definition) => {
              const back = cardBack(meaning.partOfSpeech, definition.definition);
              const active = back === selected;
              return (
                <li key={definition.definition}>
                  <button
                    type="button"
                    onClick={() => onSelect(back)}
                    aria-pressed={active}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-gold bg-[#2b2614]"
                        : "border-border-subtle bg-surface-high hover:border-ink-muted/40"
                    }`}
                  >
                    <span className="block leading-snug">{definition.definition}</span>
                    {definition.example && (
                      <span className="mt-1 block text-sm text-ink-muted italic">“{definition.example}”</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
