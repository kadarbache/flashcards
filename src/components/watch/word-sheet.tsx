"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { addWordToDeck, defineWord } from "@/app/watch/actions";
import { play } from "@/components/game/sound";
import { CheckIcon, CloseIcon, PlusIcon, SpeakIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { field, iconButton, label, primaryButton } from "@/components/ui";
import type { DictionaryEntry, LookupOutcome } from "@/lib/dictionary";

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

/** The dictionary's recording when there is one, the browser's own voice otherwise. */
function pronounce(entry: DictionaryEntry) {
  const speak = () => {
    if (!canSpeak()) return;
    const utterance = new SpeechSynthesisUtterance(entry.word);
    utterance.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };
  if (entry.audio) void new Audio(entry.audio).play().catch(speak);
  else speak();
}

/** A definition as the back of a card: "(verb) to move fast on foot", the label style the app already reads. */
function cardBack(partOfSpeech: string, definition: string): string {
  return partOfSpeech && partOfSpeech !== "word" ? `(${partOfSpeech}) ${definition}` : definition;
}

/**
 * The sheet that opens on a word: what it means, and a way to keep it.
 *
 * Every field is editable before saving -- the dictionary's first definition
 * is a starting point, not always the meaning the video used.
 */
export function WordSheet({
  pick,
  decks,
  onClose,
  onAdded,
}: {
  pick: WordPick | null;
  decks: DeckOption[];
  onClose: () => void;
  onAdded: (front: string) => void;
}) {
  return (
    <Sheet open={pick !== null} onClose={onClose} label={pick ? `Meaning of ${pick.word}` : "Word"}>
      {pick && <SheetBody key={pick.id} pick={pick} decks={decks} onClose={onClose} onAdded={onAdded} />}
    </Sheet>
  );
}

function SheetBody({
  pick,
  decks,
  onClose,
  onAdded,
}: {
  pick: WordPick;
  decks: DeckOption[];
  onClose: () => void;
  onAdded: (front: string) => void;
}) {
  const [lookup, setLookup] = useState<LookupOutcome | null>(null);
  const [front, setFront] = useState(pick.word);
  const [back, setBack] = useState("");
  const [example, setExample] = useState(pick.sentence);
  const [deckId, setDeckId] = useState(() => rememberedDeck(decks));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

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

  async function save() {
    if (saving || !deckId) return;
    setSaving(true);
    setMessage(null);
    try {
      const outcome = await addWordToDeck({ deckId, front, back, example });
      setMessage({ ok: outcome.ok, text: outcome.message });
      if (outcome.ok) {
        play("good");
        rememberDeck(deckId);
        onAdded(front);
        window.setTimeout(onClose, 900);
      }
    } catch {
      setMessage({ ok: false, text: "That could not be saved. Try again." });
    } finally {
      setSaving(false);
    }
  }

  const entry: DictionaryEntry | null = lookup?.ok ? lookup.entry : null;

  return (
    <div className="space-y-5 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold tracking-wide text-gold uppercase">From the video</p>
          <h2 className="text-3xl font-extrabold tracking-tight break-words">{entry?.word ?? pick.word}</h2>
          {entry?.phonetic && <p className="text-ink-muted">{entry.phonetic}</p>}
        </div>
        {entry && (entry.audio || canSpeak()) && (
          <button
            type="button"
            className={iconButton}
            aria-label={`Hear “${entry.word}”`}
            onClick={() => pronounce(entry)}
          >
            <SpeakIcon className="h-5 w-5" />
          </button>
        )}
        <button type="button" className={iconButton} aria-label="Close" onClick={onClose}>
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      <Meanings lookup={lookup} word={pick.word} selected={back} onSelect={setBack} />

      {decks.length === 0 ? (
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
            void save();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.2fr]">
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
            <div>
              <label className={label} htmlFor="word-deck">
                Deck
              </label>
              <select
                id="word-deck"
                className={field}
                value={deckId}
                onChange={(event) => setDeckId(event.target.value)}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
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

          {message && (
            <p
              role="status"
              className={`flex items-center gap-2 text-sm font-bold ${message.ok ? "text-good" : "text-again"}`}
            >
              {message.ok && <CheckIcon className="h-4 w-4" />}
              {message.text}
            </p>
          )}

          <button
            type="submit"
            className={`${primaryButton} w-full`}
            disabled={saving || front.trim() === "" || back.trim() === "" || message?.ok === true}
          >
            <PlusIcon className="h-5 w-5" />
            {saving ? "Adding…" : "Add to deck"}
          </button>
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
