"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { askWordFinder } from "@/app/find/actions";
import { ArrowIcon, SearchIcon } from "@/components/icons";
import { cardSpeaker, SpeakerButton } from "@/components/speaker";
import { field, iconButton, panel } from "@/components/ui";
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
 * A chat for finding a word you forgot: describe what it means and the AI
 * looks through every card for it. Follow-ups like "no, a verb" work, since
 * the earlier messages go along with each question.
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
  const nextId = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Keep the newest message and the box to type in on screen.
  useEffect(() => {
    if (messages.length > 0 || pending) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, pending]);

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

  function startOver() {
    setMessages([]);
    setDraft("");
    setError(null);
    input.current?.focus();
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center gap-2.5">
        <Link href="/" className={iconButton} aria-label="Back to home">
          <ArrowIcon direction="left" className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl leading-tight font-extrabold tracking-tight">Find a word</h1>
          <p className="truncate text-sm text-ink-muted tabular-nums">
            Looks through {cardCount} {cardCount === 1 ? "card" : "cards"}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={startOver}
            disabled={pending}
            className="h-10 rounded-full px-3 text-sm font-bold text-ink-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-50"
          >
            Start over
          </button>
        )}
      </div>

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
      ) : (
        <>
          {messages.length === 0 && !pending ? (
            <section className={`${panel} anim-rise space-y-4`}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-high text-gold">
                  <SearchIcon className="h-6 w-6" />
                </span>
                <p className="text-ink-muted">
                  Remember what a word means but not the word? Describe it, and the AI looks through your cards for
                  it.
                </p>
              </div>
              <ul className="space-y-2">
                {STARTERS.map((starter) => (
                  <li key={starter}>
                    <button
                      type="button"
                      onClick={() => void ask(starter)}
                      className="w-full rounded-2xl bg-surface-high px-4 py-3 text-left text-sm font-semibold transition hover:bg-[#2f2a4a] active:scale-[0.99]"
                    >
                      “{starter}”
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <ol role="log" aria-live="polite" aria-label="Conversation" className="space-y-4">
              {messages.map((message) =>
                message.role === "user" ? (
                  <li key={message.id} className="flex justify-end">
                    <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-gold px-4 py-2.5 font-semibold break-words text-paper-ink">
                      {message.text}
                    </p>
                  </li>
                ) : (
                  <li key={message.id} className="anim-rise space-y-2.5">
                    <p className="max-w-[90%] rounded-3xl rounded-bl-lg bg-surface-raised px-4 py-3 break-words">
                      {message.text}
                    </p>
                    {message.matches.length > 0 && (
                      <ul className="space-y-2" aria-label="Matching cards">
                        {message.matches.map((card) => (
                          <MatchCard key={card.id} card={card} aiVoice={aiVoice} />
                        ))}
                      </ul>
                    )}
                  </li>
                ),
              )}
              {pending && (
                <li className="flex">
                  <p
                    className="flex items-center gap-1.5 rounded-3xl rounded-bl-lg bg-surface-raised px-4 py-4"
                    aria-label="Looking through your cards"
                  >
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

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void ask(draft);
            }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <label htmlFor="word-finder-question" className="sr-only">
                Describe the word
              </label>
              <input
                ref={input}
                id="word-finder-question"
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={messages.length === 0 ? "Describe the word you forgot" : "Ask a follow-up"}
                maxLength={MAX_MESSAGE}
                enterKeyHint="send"
                autoComplete="off"
                className={field}
              />
              <button
                type="submit"
                disabled={pending || draft.trim() === ""}
                aria-label="Ask"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold text-paper-ink transition active:scale-95 disabled:opacity-40"
              >
                <ArrowIcon direction="up" className="h-5 w-5" />
              </button>
            </div>
            {error && (
              <p role="alert" className="px-1 text-sm font-semibold text-again">
                {error}
              </p>
            )}
          </form>
        </>
      )}
      <div ref={end} />
    </div>
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
    <section className={`${panel} space-y-2`}>
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="text-sm text-ink-muted">{children}</p>
    </section>
  );
}
