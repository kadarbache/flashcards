"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { ArrowIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { cardSpeaker, SpeakerButton } from "@/components/speaker";
import { iconButton, panel } from "@/components/ui";
import { parseChatText, settleWriting, type Span } from "@/lib/chat-text";
import {
  MAX_MESSAGE,
  readLines,
  type FinderEvent,
  type FinderFailure,
  type FinderMatch,
} from "@/lib/word-finder";

type Message =
  | { id: number; role: "user"; text: string }
  /** `cut` when the answer stopped before it was finished, by stop or by failure. */
  | { id: number; role: "assistant"; text: string; matches: FinderMatch[]; cut?: boolean };

/** Ways to start, for an empty chat. Tapping one asks it. */
const STARTERS = [
  "That word for knowing something without thinking it through",
  "A word that means very exact",
  "How do I use “precise” in a sentence?",
];

type Failure = FinderFailure | "signed-out";

const FAILURES: Record<Failure, string> = {
  "no-key": "The word finder needs GEMINI_API_KEY on the server.",
  "no-cards": "There are no cards to look through yet.",
  "bad-question": "That question could not be read. Try asking it again.",
  failed: "No answer came back just now. Try again in a moment.",
  "signed-out": "You were signed out. Reload the page to sign in again.",
};

/** When an answer stops partway, what was written stays in the chat. */
const CUT_OFF = "The answer stopped partway. Ask again for the rest.";

/**
 * The bar along the top. On phones it stays put while the chat scrolls under
 * it, reaching up under the notch; the negative margin undoes the page's own
 * top padding so it starts at the very top. On wider screens the site header
 * is already there, so it is a plain row.
 */
const topBar =
  "sticky top-0 z-20 -mx-4 mt-[calc(-1*(env(safe-area-inset-top)+1.25rem))] flex items-center gap-2.5 border-b border-white/5 bg-ground/85 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 backdrop-blur-md md:static md:mx-0 md:mt-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none";

/**
 * A chat about your words, laid out like an AI chat app: the conversation
 * scrolls, the box to type in stays at the bottom of the screen. Describe a
 * word you forgot and the AI names it, with its card; then ask anything about
 * it (how to use it, examples, how it differs from another word) and it
 * answers like a tutor. Answers type out as they are written, and the send
 * button stops one. A card shows once, the first time its word comes up.
 * Nothing is kept: leaving the page or "New chat" starts fresh.
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
  const log = useRef<HTMLOListElement>(null);
  /** Stops the answer being written. */
  const answering = useRef<AbortController | null>(null);
  /** Whether to keep scrolling down as an answer grows. */
  const following = useRef(true);

  const usable = ready && cardCount > 0;
  const empty = messages.length === 0 && !pending;
  const last = messages.at(-1);
  /** The answer still being written, once its first words are in. */
  const writingId = pending && last?.role === "assistant" ? last.id : null;

  // The box is fixed to the bottom of the screen, over the page. Leave that
  // much room under the last message, however tall the box grows.
  useEffect(() => {
    const box = composer.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setComposerHeight(box.offsetHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, [usable]);

  // Scrolling up to read stops the chat following an answer down; scrolling
  // back to the bottom starts it again.
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const fromBottom = document.documentElement.scrollHeight - window.innerHeight - y;
      if (fromBottom < 80) following.current = true;
      else if (y < lastY) following.current = false;
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Keep the newest message in view, just above the box.
  useEffect(() => {
    if (empty || !following.current) return;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }, [empty, messages.length, pending, composerHeight]);

  // And stay at the bottom as an answer types out and pushes the page longer.
  useEffect(() => {
    const list = log.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (following.current) window.scrollTo({ top: document.documentElement.scrollHeight });
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [empty]);

  // Leaving the page stops an answer still being written, and Gemini with it.
  useEffect(() => () => answering.current?.abort(), []);

  async function ask(text: string) {
    const question = text.trim();
    if (question === "" || pending) return;

    const asked: Message = { id: nextId.current++, role: "user", text: question };
    let answerId = nextId.current++;
    const conversation = [...messages, asked];
    setMessages(conversation);
    setDraft("");
    setError(null);
    setPending(true);
    following.current = true;

    // A card shows once a chat, the first time its word comes up. Follow-ups
    // about that word get an answer, not the same card again.
    const shown = new Set(
      messages.flatMap((message) => (message.role === "assistant" ? message.matches.map((card) => card.id) : [])),
    );
    const showAnswer = (text: string, matches: FinderMatch[] = []) => {
      // Taken now: React runs the update later, perhaps after a restart has moved on to a new id.
      const id = answerId;
      setMessages((current) => [
        ...current.filter((message) => message.id !== id),
        { id, role: "assistant", text, matches: matches.filter((card) => !shown.has(card.id)) },
      ]);
    };

    const controller = new AbortController();
    answering.current = controller;
    let written = "";
    let finished = false;
    let failure: Failure | null = null;
    try {
      const response = await fetch("/find/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversation: conversation.map(({ role, text }) => ({ role, text })) }),
        // Signed out, the proxy answers with a redirect to the login page.
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status === 401 || response.type === "opaqueredirect") {
        failure = "signed-out";
      } else if (!response.ok || !response.body) {
        failure = "failed";
      } else {
        for await (const line of readLines(response.body)) {
          if (line.trim() === "") continue;
          const event = JSON.parse(line) as FinderEvent;
          if ("text" in event) {
            written += event.text;
            showAnswer(written);
          } else if ("restart" in event) {
            // Gemini broke off and is starting over. Take down what it wrote,
            // and the new answer types out afresh under a new id.
            const broken = answerId;
            answerId = nextId.current++;
            written = "";
            setMessages((current) => current.filter((message) => message.id !== broken));
          } else if ("done" in event) {
            finished = true;
            showAnswer(event.reply, event.matches);
          } else {
            failure = event.error;
          }
        }
        if (!finished) failure ??= "failed";
      }
    } catch {
      // A network error, or stopped on purpose.
      if (!controller.signal.aborted) failure = "failed";
    }
    answering.current = null;

    const lastId = answerId;
    if (!finished && written.trim() === "") {
      // Nothing came. Take the question back off the chat and put it back in
      // the box, so trying again is one tap and the chat never holds a
      // question with no answer.
      setMessages((current) => current.filter((message) => message.id !== asked.id && message.id !== lastId));
      setDraft(question);
    } else if (!finished) {
      // Show what came straight away, rather than go on typing after a stop.
      setMessages((current) =>
        current.map((message) => (message.id === lastId ? { ...message, cut: true } : message)),
      );
    }
    if (failure) setError(written.trim() === "" ? FAILURES[failure] : CUT_OFF);
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
        <ol
          ref={log}
          role="log"
          aria-live="polite"
          aria-busy={pending}
          aria-label="Conversation"
          className="space-y-6 pt-6"
        >
          {messages.map((message) =>
            message.role === "user" ? (
              <li key={message.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-3xl bg-surface-high px-4 py-2.5 break-words whitespace-pre-wrap">
                  {message.text}
                </p>
              </li>
            ) : (
              <Answer key={message.id} message={message} writing={message.id === writingId} aiVoice={aiVoice} />
            ),
          )}
          {pending && writingId === null && (
            <li className="flex gap-3">
              <Avatar />
              <p className="flex h-8 items-center gap-1.5" aria-label="Thinking">
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
                  Ask about your words
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
                  placeholder={messages.length === 0 ? "Describe a word, or ask about one" : "Ask anything about it"}
                  maxLength={MAX_MESSAGE}
                  enterKeyHint="send"
                  autoComplete="off"
                  className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-base text-ink outline-none placeholder:text-ink-muted/60"
                />
                {pending ? (
                  <button
                    type="button"
                    onClick={() => answering.current?.abort()}
                    aria-label="Stop the answer"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-paper-ink transition active:scale-90"
                  >
                    <span aria-hidden="true" className="h-3.5 w-3.5 rounded-[3px] bg-current" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={draft.trim() === ""}
                    aria-label="Ask"
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-paper-ink transition active:scale-90 disabled:bg-surface-high disabled:text-ink-muted"
                  >
                    <ArrowIcon direction="up" className="h-5 w-5" />
                  </button>
                )}
              </div>
              <p className="mt-2 text-center text-xs text-ink-muted">
                Knows the words in your cards. Answers can be wrong.
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
          Describe what it means and I&rsquo;ll find it in your {cardCount} {cardCount === 1 ? "card" : "cards"}. Then
          ask me how to use it.
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

/**
 * How much of `text` to show, typed out a few letters a frame. The model's
 * pieces arrive in bursts of a sentence or more; this evens them out so the
 * answer reads like typing. It speeds up when far behind, so a long answer
 * still finishes within a couple of seconds of arriving. `instant` shows it
 * all at once.
 */
function useTypewriter(text: string, instant: boolean): string {
  const [shown, setShown] = useState(0);
  const behind = text.length - shown;
  useEffect(() => {
    if (instant || behind <= 0) return;
    const frame = requestAnimationFrame(() =>
      setShown((current) => Math.min(text.length, current + Math.max(3, Math.ceil(behind / 60)))),
    );
    return () => cancelAnimationFrame(frame);
  }, [instant, behind, text.length]);
  return instant ? text : text.slice(0, shown);
}

/** An answer, typed out, with its cards underneath once it is all there. */
function Answer({
  message,
  writing,
  aiVoice,
}: {
  message: Extract<Message, { role: "assistant" }>;
  writing: boolean;
  aiVoice: boolean;
}) {
  const shown = useTypewriter(message.text, message.cut === true);
  const typing = writing || shown.length < message.text.length;
  return (
    <li className="anim-rise flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 space-y-3 pt-1">
        <ChatText text={shown} writing={typing} />
        {!typing && message.matches.length > 0 && (
          <ul className="anim-rise grid gap-2 sm:grid-cols-2" aria-label="Matching cards">
            {message.matches.map((card) => (
              <MatchCard key={card.id} card={card} aiVoice={aiVoice} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** An answer's text: paragraphs, lists, bold and italic. `writing` while it is still coming in. */
function ChatText({ text, writing = false }: { text: string; writing?: boolean }) {
  return (
    <div className="space-y-3 leading-relaxed break-words">
      {parseChatText(writing ? settleWriting(text) : text).map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                <Spans spans={line} />
              </Fragment>
            ))}
          </p>
        ) : (
          <ChatList key={index} ordered={block.ordered} items={block.items} />
        ),
      )}
    </div>
  );
}

function ChatList({ ordered, items }: { ordered: boolean; items: Span[][] }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={`space-y-1.5 pl-5 marker:text-gold ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((item, index) => (
        <li key={index} className="pl-1">
          <Spans spans={item} />
        </li>
      ))}
    </List>
  );
}

function Spans({ spans }: { spans: Span[] }) {
  return spans.map((span, index) =>
    span.bold ? (
      <strong key={index} className={`font-bold text-ink ${span.italic ? "italic" : ""}`}>
        {span.text}
      </strong>
    ) : span.italic ? (
      <em key={index}>{span.text}</em>
    ) : (
      <Fragment key={index}>{span.text}</Fragment>
    ),
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
