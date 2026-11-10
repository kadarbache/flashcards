import type { FetchLike } from "@/lib/transcript-sources";

/**
 * A chat about your own words. Describe one you forgot and the model names the
 * card; ask how to use it, for examples, or how it differs from another word,
 * and it answers like a tutor, from its own knowledge of English. Every card
 * goes to a Gemini model with the conversation. A few hundred cards are a few
 * thousand tokens, so there is no search index to build or keep in step with
 * the cards: the model reads them all, every time.
 *
 * The answer streams: the reply is passed on a piece at a time as the model
 * writes it, so the page can show it growing, and the cards come once the
 * answer is complete.
 *
 * Uses GEMINI_API_KEY, the same free key as the AI voice.
 */

/**
 * The quickest model tried that also says plainly when no card fits, rather
 * than offering a loosely related one. About a second a question with 130
 * cards. GEMINI_CHAT_MODEL picks another.
 */
export const DEFAULT_CHAT_MODEL = "gemini-3.5-flash-lite";
/**
 * Asked in turn with the chosen model when Gemini is overloaded. A different
 * model is often not busy at the same moment.
 */
export const SPARE_CHAT_MODEL = "gemini-3.5-flash";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** For the whole answer, tries included. A long one from the default model takes about five seconds. */
const TIMEOUT_MS = 30_000;
/**
 * Gemini is sometimes overloaded (503), before an answer or partway through
 * one. It is asked this many times in all, the chosen and spare models in turn.
 */
const MAX_TRIES = 3;
const RETRY_DELAY_MS = 800;

/** What one message may hold. A description of a word is a sentence or two. */
export const MAX_MESSAGE = 500;
/** Earlier messages kept for follow-ups like "no, a verb". Older ones are dropped. */
const MAX_TURNS = 12;
/** Cards named in one answer. */
const MAX_MATCHES = 5;
/** Room for an explanation with a few example sentences, about 1,000 tokens. */
const MAX_REPLY = 4000;
/** Long meanings and examples are cut in the prompt; the card itself is untouched. */
const MAX_MEANING = 300;
const MAX_EXAMPLE = 160;
/**
 * Past this many characters of cards, examples are left out to keep each
 * question quick and cheap. About 50,000 tokens; 130 cards are under 5,000.
 */
const EXAMPLES_BUDGET = 200_000;

export interface FinderCard {
  id: string;
  deckId: string;
  deckName: string;
  front: string;
  back: string;
  example: string;
}

/** A card the answer points to, as the page shows it. */
export type FinderMatch = Omit<FinderCard, "example">;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export type FinderFailure = "no-key" | "no-cards" | "bad-question" | "failed";

export type FinderOutcome =
  | { ok: true; reply: string; matches: FinderMatch[] }
  | { ok: false; reason: FinderFailure };

/**
 * One line of the answer as the server streams it to the page: each new piece
 * of the reply as it is written, then the whole reply with its cards, or why
 * there is no answer.
 */
export type FinderEvent =
  | { text: string }
  /** Gemini broke off partway and is asked again: what was written so far goes. */
  | { restart: true }
  | { done: true; reply: string; matches: FinderMatch[] }
  | { error: FinderFailure };

const INSTRUCTIONS = `You are a warm, friendly English tutor chatting with someone who is learning the words on their own flashcards. Their cards are below, one per line: number, word, meaning, and sometimes an example sentence.

They come to you for two things:
1. Finding a word they forgot. They describe what it means and you name the card that fits. When none of their cards fit, say the word is not in their cards and give the English word they most likely mean.
2. Talking about words: what one means, how to use it, example sentences, grammar, nuance and tone, synonyms and opposites, how two words differ, where a word comes from. Answer these the way a good tutor would, from your own knowledge of English, not only from what the card says. Never just read the card's meaning back to them.

reply: your answer, written the way a person talks in a chat, not like a dictionary entry. Fit the length to the question: a sentence or two to name a word; more when they ask how to use one, with two or three natural example sentences. You may use **bold** for words and "- " bullet lists for examples, with real line breaks: a blank line between paragraphs and each bullet on a line of its own. No headings. Never mention card numbers.

cards: the numbers of cards this answer introduces, best first, at most ${MAX_MATCHES}: the word they were looking for, or a word of theirs they ask about for the first time in this chat. The person already sees a word's card the first time it comes up, so leave a card out once the word has come up earlier in the conversation; follow-up questions about it get an empty list. Leave out cards that are only loosely related. Empty when none fit.`;

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "The answer, as a chat message" },
    cards: {
      type: "array",
      items: { type: "integer" },
      description: "Numbers of cards this answer introduces, best first; empty for follow-ups",
    },
  },
  required: ["reply", "cards"],
} as const;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The conversation from the page, checked: whole turns only, the newest
 * {@link MAX_TURNS}, ending on the person's question. Null when there is no
 * question to answer.
 */
export function cleanConversation(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown })?.role;
    const text = (item as { text?: unknown })?.text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") return null;
    const trimmed = text.trim();
    if (trimmed === "") return null;
    turns.push({ role, text: trimmed.slice(0, role === "user" ? MAX_MESSAGE : MAX_REPLY) });
  }
  const recent = turns.slice(-MAX_TURNS);
  // Gemini wants the conversation to open with the person, and the last turn is the question.
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();
  if (recent.length === 0 || recent[recent.length - 1].role !== "user") return null;
  return recent;
}

/** The cards as numbered lines, the way the model is shown them. */
export function cardList(cards: readonly FinderCard[]): string {
  const line = (card: FinderCard, index: number, withExample: boolean) => {
    const base = `${index + 1}. ${oneLine(card.front)} = ${cut(oneLine(card.back), MAX_MEANING)}`;
    const example = oneLine(card.example);
    return withExample && example ? `${base} (example: "${cut(example, MAX_EXAMPLE)}")` : base;
  };
  const full = cards.map((card, index) => line(card, index, true)).join("\n");
  if (full.length <= EXAMPLES_BUDGET) return full;
  return cards.map((card, index) => line(card, index, false)).join("\n");
}

/** The request Gemini is sent. Thinking is kept to a minimum, since it only adds wait here. */
export function buildRequest(turns: readonly ChatTurn[], cards: readonly FinderCard[], thinkingOff: boolean) {
  return {
    systemInstruction: { parts: [{ text: `${INSTRUCTIONS}\n\n<cards>\n${cardList(cards)}\n</cards>` }] },
    contents: turns.map((turn) => ({
      role: turn.role === "user" ? "user" : "model",
      parts: [{ text: turn.text }],
    })),
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: SCHEMA,
      // Thinking counts against this too, when a larger model does some.
      maxOutputTokens: 2048,
      ...(thinkingOff ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
    },
  };
}

/** The model's answer with its card numbers turned back into cards, or null when it is not usable. */
export function parseAnswer(
  content: string,
  cards: readonly FinderCard[],
): { reply: string; matches: FinderMatch[] } | null {
  let answer: { reply?: unknown; cards?: unknown };
  try {
    // Some models wrap JSON in a code fence even when asked for a schema.
    answer = JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    return null;
  }

  const reply = typeof answer.reply === "string" ? answer.reply.trim() : "";
  if (reply === "") return null;

  const seen = new Set<number>();
  const matches: FinderMatch[] = [];
  for (const value of Array.isArray(answer.cards) ? answer.cards : []) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > cards.length || seen.has(number)) continue;
    seen.add(number);
    const { id, deckId, deckName, front, back } = cards[number - 1];
    matches.push({ id, deckId, deckName, front, back });
    if (matches.length === MAX_MATCHES) break;
  }

  return { reply: cut(reply, MAX_REPLY), matches };
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

/**
 * The reply, read out of the model's JSON as far as it has been written:
 * `{"reply":"It means \"exa` gives `It means "exa`. An escape cut off at the
 * end waits for the rest. Empty until the reply has begun.
 */
export function partialReply(json: string): string {
  const opening = /"reply"\s*:\s*"/.exec(json);
  if (!opening) return "";
  let reply = "";
  for (let index = opening.index + opening[0].length; index < json.length; index++) {
    const char = json[index];
    if (char === '"') break;
    if (char !== "\\") {
      reply += char;
      continue;
    }
    const escaped = json[index + 1];
    if (escaped === undefined) break;
    if (escaped === "u") {
      const hex = json.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      reply += String.fromCharCode(parseInt(hex, 16));
      index += 5;
    } else {
      reply += ESCAPES[escaped] ?? escaped;
      index += 1;
    }
  }
  return reply;
}

/**
 * The lines of a streamed body as they arrive, without their line endings.
 * Works in the browser too, so the page reads the server's stream with it.
 */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      finished = done;
      // `stream: true` holds back a character split between two chunks.
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");
      yield* lines;
    }
  } finally {
    // Left early, on an error or a break: hang up rather than leave the rest unread.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Gemini broke off partway through an answer, almost always because it is overloaded. */
class BrokenOff extends Error {}

/**
 * The text Gemini writes, a piece at a time, from its server-sent events: one
 * `data:` line of JSON per event. Throws BrokenOff when an event reports an error.
 */
async function* geminiText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const line of readLines(body)) {
    if (!line.startsWith("data:")) continue;
    const event = JSON.parse(line.slice(5)) as {
      error?: unknown;
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>;
    };
    if (event.error) throw new BrokenOff("Gemini broke off partway with an error");
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part?.text === "string" && !part.thought) yield part.text;
    }
  }
}

export interface FinderOptions {
  apiKey: string;
  /** A Gemini model id. Defaults to DEFAULT_CHAT_MODEL. */
  model?: string | null;
  fetchImpl?: FetchLike;
  /** The wait before trying again after a server error. Tests set it to 0. */
  retryDelayMs?: number;
  /** Called with each new piece of the reply as the model writes it. */
  onText?: (text: string) => void;
  /** Called when Gemini broke off partway and is asked again, so the reply written so far is void. */
  onRestart?: () => void;
  /** Stops the answer partway, as when the person leaves or presses stop. */
  signal?: AbortSignal;
}

/** Answer the last question in `turns`, with any cards the answer introduces. */
export async function findWords(
  turns: readonly ChatTurn[],
  cards: readonly FinderCard[],
  { apiKey, model, fetchImpl = fetch, retryDelayMs = RETRY_DELAY_MS, onText, onRestart, signal }: FinderOptions,
): Promise<FinderOutcome> {
  if (cards.length === 0) return { ok: false, reason: "no-cards" };
  const chosen = model?.trim() || DEFAULT_CHAT_MODEL;
  const models = chosen === SPARE_CHAT_MODEL ? [chosen] : [chosen, SPARE_CHAT_MODEL];
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const stop = signal ? AbortSignal.any([signal, timeout]) : timeout;

  /** Models that refused minimal thinking, and are asked with their own default. */
  const thinkers = new Set<string>();
  let json = "";
  /** How much of the reply has been passed on. */
  let sent = 0;

  const ask = (name: string) =>
    fetchImpl(`${ENDPOINT}/${encodeURIComponent(name)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(buildRequest(turns, cards, !thinkers.has(name))),
      signal: stop,
    });

  /**
   * One go at an answer from `name`, passing the reply on as it grows. "busy"
   * when Gemini is overloaded, which it may say before the answer or partway
   * through it; otherwise the status it refused with.
   */
  const attempt = async (name: string): Promise<"done" | "busy" | number> => {
    let response = await ask(name);
    // Larger models refuse minimal thinking. Ask again with their own default.
    if (response.status === 400 && !thinkers.has(name)) {
      thinkers.add(name);
      response = await ask(name);
    }
    if (response.status >= 500) return "busy";
    if (!response.ok || !response.body) return response.status;

    json = "";
    try {
      for await (const text of geminiText(response.body)) {
        json += text;
        const reply = partialReply(json).trimStart().slice(0, MAX_REPLY);
        if (reply.length > sent) {
          onText?.(reply.slice(sent));
          sent = reply.length;
        }
      }
    } catch (error) {
      if (error instanceof BrokenOff) return "busy";
      throw error;
    }
    return "done";
  };

  try {
    let result = await attempt(models[0]);
    for (let tries = 1; result === "busy" && tries < MAX_TRIES; tries++) {
      // Overloaded is usually over in a moment, or another model has room.
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      if (sent > 0) {
        // It broke off partway: the next go writes a different reply.
        onRestart?.();
        sent = 0;
      }
      result = await attempt(models[tries % models.length]);
    }
    if (result !== "done") {
      // 429 is the free allowance used up for now; 400 or 403 a key or model problem.
      const why = result === "busy" ? `was overloaded (${models.join(", ")})` : `answered ${result} for ${chosen}`;
      console.warn(`Gemini ${why}; the word finder could not answer.`);
      return { ok: false, reason: "failed" };
    }
    const answer = parseAnswer(json, cards);
    return answer ? { ok: true, ...answer } : { ok: false, reason: "failed" };
  } catch {
    // A timeout, a network error, or stopped.
    return { ok: false, reason: "failed" };
  }
}
