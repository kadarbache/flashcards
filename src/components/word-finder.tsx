"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { askWordFinder } from "@/app/find/actions";
import { ArrowIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { cardSpeaker, SpeakerButton } from "@/components/speaker";
import { iconButton, panel } from "@/components/ui";
import { MAX_MESSAGE, type FinderMatch, type FinderOutcome } from "@/lib/word-finder";

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; matches: FinderMatch[] };

/** Ways to start, for an empty chat. Tapping one asks it. */
const STARTERS = [
  "That word for knowing something without thinking it through",
  "A word that means very exact",
  "The verb for making something better",
];

const FAILURES: Record<Exclude<FinderOutcome, { ok: true }>["reason"], string> = {
  "no-key": "The word finder needs GEMINI_API_KEY on the server.",
  "no-cards": "There are no cards to look through yet.",
  "bad-question": "That question could not be read. Try asking it again.",
  failed: "No answer came back just now. Try again in a moment.",
};

/**
 * The bar along the top. On phones it stays put while the chat scrolls under
 * it, reaching up under the notch; the negative margin undoes the page's own
 * top padding so it starts at the very top. On wider screens the site header
 * is already there, so it is a plain row.
 */
const topBar =
  "sticky top-0 z-20 -mx-4 mt-[calc(-1*(env(safe-area-inset-top)+1.25rem))] flex items-center gap-2.5 border-b border-white/5 bg-ground/85 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 backdrop-blur-md md:static md:mx-0 md:mt-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none";

/**
 * A chat for finding a word you forgot, laid out like an AI chat app: the
 * conversation scrolls, the box to type in stays at the bottom of the screen.
 * Describe what the word means and the AI looks through every card for it.
 * Follow-ups like "no, a verb" work, since the earlier messages go along with
 * each question. Nothing is kept: leaving the page or "New chat" starts fresh.
 */
export function WordFinder({
  cardCount,
  ready,
  aiVoice,
}: {
  cardCount: number;
  ready: boolean;
  aiVoice: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const nextId = useRef(0);
  const composer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const usable = ready && cardCount > 0;
  const empty = messages.length === 0 && !pending;

  // The box is fixed to the bottom of the screen, over the page. Leave that
  // much room under the last message, however tall the box grows.
  useEffect(() => {
    const box = composer.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setComposerHeight(box.offsetHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, [usable]);

  // Keep the newest message in view, just above the box.
  useEffect(() => {
    if (empty) return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }, [empty, messages.length, pending, composerHeight]);

  async function ask(text: string) {
    const question = text.trim();
    if (question === "" || pending) return;

    const asked: Message = { id: nextId.current++, role: "user", text: question };
    const conversation = [...messages, asked];
    setMessages(conversation);
    setDraft("");
    setError(null);
    setPending(true);

    let outcome: FinderOutcome;
    try {
      outcome = await askWordFinder(conversation.map(({ role, text }) => ({ role, text })));
    } catch {
      outcome = { ok: false, reason: "failed" };
    }

    if (outcome.ok) {
      const { reply, matches } = outcome;
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: reply, matches }]);
    } else {
      // Take the question back off the chat and put it back in the box, so
      // trying again is one tap and the chat never holds a question with no answer.
      setMessages((current) => current.filter((message) => message.id !== asked.id));
      setDraft(question);
      setError(FAILURES[outcome.reason]);
    }
    setPending(false);
  }

  function newChat() {
    setMessages([]);
    setDraft("");
    setError(null);
    window.scrollTo({ top: 0 });
    input.current?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className={topBar}>
        <Link href="/" className={iconButton} aria-label="Back to home">
          <ArrowIcon direction="left" className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg leading-tight font-extrabold tracking-tight">Find a word</h1>
          <p className="truncate text-xs text-ink-muted tabular-nums">
            {cardCount} {cardCount === 1 ? "card" : "cards"} to look through
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={newChat}
            disabled={pending}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-surface-raised px-3.5 text-sm font-bold transition hover:bg-surface-high active:scale-95 disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            New chat
          </button>
        )}
      </header>

      {!ready ? (
        <Notice title="Add a Gemini key">
          Set <code className="text-ink">GEMINI_API_KEY</code> in <code className="text-ink">.env.local</code> (and on
          Vercel), with a free key from <span className="text-ink">aistudio.google.com/apikey</span>, then restart the
          app. It is the same key the AI voice uses.
        </Notice>
      ) : cardCount === 0 ? (
        <Notice title="No cards yet">
          Add some words to a deck first, then come back to find them by their meaning.{" "}
          <Link href="/" className="font-bold text-gold underline-offset-2 hover:underline">
            Go to your decks
          </Link>
        </Notice>
      ) : empty ? (
        <Welcome cardCount={cardCount} onPick={(starter) => void ask(starter)} />
      ) : (
        <ol role="log" aria-live="polite" aria-label="Conversation" className="space-y-6 pt-6">
          {messages.map((message) =>
            message.role === "user" ? (
              <li key={message.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-3xl bg-surface-high px-4 py-2.5 break-words whitespace-pre-wrap">
                  {message.text}
                </p>
              </li>
            ) : (
              <li key={message.id} className="anim-rise flex gap-3">
                <Avatar />
                <div className="min-w-0 flex-1 space-y-3 pt-1">
                  <p className="leading-relaxed break-words">{message.text}</p>
                  {message.matches.length > 0 && (
                    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Matching cards">
                      {message.matches.map((card) => (
                        <MatchCard key={card.id} card={card} aiVoice={aiVoice} />
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ),
          )}
          {pending && (
            <li className="flex gap-3">
              <Avatar />
              <p className="flex h-8 items-center gap-1.5" aria-label="Looking through your cards">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="h-2 w-2 animate-pulse rounded-full bg-ink-muted"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </p>
            </li>
          )}
        </ol>
      )}

      {usable && (
        <>
          {/* Room for the box, which floats over the page. 8rem fits it as it first
              appears; once measured, the measure takes over, for a box grown taller. */}
          <div aria-hidden="true" className="h-32" style={composerHeight > 0 ? { height: composerHeight } : undefined} />
          <div
            ref={composer}
            className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-ground from-70% to-ground/0 px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask(draft);
              }}
              className="mx-auto max-w-3xl"
            >
              {error && (
                <p role="alert" className="mb-2 px-4 text-sm font-semibold text-again">
                  {error}
                </p>
              )}
              <div className="flex items-end gap-2 rounded-[1.75rem] border border-border-subtle bg-surface-raised p-2 pl-5 shadow-[0_12px_32px_-12px_rgba(0,0,0,.8)] transition focus-within:border-gold/60">
                <label htmlFor="word-finder-question" className="sr-only">
                  Describe the word
                </label>
                <textarea
                  ref={input}
                  id="word-finder-question"
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter sends, Shift+Enter starts a new line, and Enter that
                    // finishes a word in an input method (Japanese, say) does neither.
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void ask(draft);
                    }
                  }}
                  placeholder={messages.length === 0 ? "Describe the word you forgot" : "Ask a follow-up"}
                  maxLength={MAX_MESSAGE}
                  enterKeyHint="send"
                  autoComplete="off"
                  className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-base text-ink outline-none placeholder:text-ink-muted/60"
                />
                <button
                  type="submit"
                  disabled={pending || draft.trim() === ""}
                  aria-label="Ask"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-paper-ink transition active:scale-90 disabled:bg-surface-high disabled:text-ink-muted"
                >
                  <ArrowIcon direction="up" className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-ink-muted">
                Looks through your cards only. Answers can be wrong.
              </p>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

/** The empty chat: what to do, and a few ways to start. */
function Welcome({ cardCount, onPick }: { cardCount: number; onPick: (starter: string) => void }) {
  return (
    <section className="anim-rise flex min-h-[calc(100dvh-17rem)] flex-col items-center justify-center gap-6 py-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 text-gold">
        <SearchIcon className="h-7 w-7" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-2xl font-extrabold tracking-tight">Which word is it?</h2>
        <p className="mx-auto max-w-sm text-ink-muted">
          Describe what it means, and I&rsquo;ll find it in your {cardCount} {cardCount === 1 ? "card" : "cards"}.
        </p>
      </div>
      <ul className="grid w-full gap-2 sm:grid-cols-3">
        {STARTERS.map((starter) => (
          <li key={starter}>
            <button
              type="button"
              onClick={() => onPick(starter)}
              className="h-full w-full rounded-2xl border border-border-subtle px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-raised hover:text-ink active:scale-[0.99]"
            >
              {starter}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The finder's mark beside its answers. */
function Avatar() {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold"
    >
      <SearchIcon className="h-4 w-4" />
    </span>
  );
}

/** A card the answer points to, on paper like the flashcards themselves. */
function MatchCard({ card, aiVoice }: { card: FinderMatch; aiVoice: boolean }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-paper p-3.5 text-paper-ink">
      <div className="min-w-0 flex-1">
        <p className="text-lg leading-tight font-extrabold break-words">{card.front}</p>
        <p className="mt-1 text-sm break-words text-paper-muted">{card.back}</p>
        {card.deckName && (
          <Link
            href={`/decks/${card.deckId}`}
            className="mt-1.5 inline-block text-xs font-bold text-[#5b4bb0] underline-offset-2 hover:underline"
          >
            {card.deckName}
          </Link>
        )}
      </div>
      <SpeakerButton text={card.front} aiVoice={aiVoice} className={cardSpeaker} />
    </li>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${panel} mt-6 space-y-2`}>
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="text-sm text-ink-muted">{children}</p>
    </section>
  );
}
