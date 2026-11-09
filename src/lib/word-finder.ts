import type { FetchLike } from "@/lib/transcript-sources";

/**
 * Find a word you forgot by describing it. Every card goes to a Gemini model
 * with the question, and the model says which cards fit. A few hundred cards
 * are a few thousand tokens, so there is no search index to build or keep in
 * step with the cards: the model reads them all, every time.
 *
 * Uses GEMINI_API_KEY, the same free key as the AI voice.
 */

/**
 * The quickest model tried that also says plainly when no card fits, rather
 * than offering a loosely related one. About a second a question with 130
 * cards. GEMINI_CHAT_MODEL picks another.
 */
export const DEFAULT_CHAT_MODEL = "gemini-3.5-flash-lite";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 15_000;

/** What one message may hold. A description of a word is a sentence or two. */
export const MAX_MESSAGE = 500;
/** Earlier messages kept for follow-ups like "no, a verb". Older ones are dropped. */
const MAX_TURNS = 12;
/** Cards named in one answer. */
const MAX_MATCHES = 5;
const MAX_REPLY = 1000;
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

export type FinderOutcome =
  | { ok: true; reply: string; matches: FinderMatch[] }
  | { ok: false; reason: "no-key" | "no-cards" | "bad-question" | "failed" };

const INSTRUCTIONS = `You help someone find words in their own flashcards. They remember what a word means but not the word itself. Their cards are below, one per line: number, word, meaning, and sometimes an example sentence.

- cards: the numbers of the cards whose meaning matches what they describe, best first, at most ${MAX_MATCHES}. Leave out cards that are only loosely related. Empty when none match.
- reply: one or two short, friendly sentences in plain English. Name the word. Never mention card numbers. When none of their cards match, say the word is not in their cards and give the English word they most likely mean.

They may ask follow-up questions about earlier answers, or ask about the words in other ways. Answer from their cards when you can.`;

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Short answer naming the word" },
    cards: {
      type: "array",
      items: { type: "integer" },
      description: "Numbers of the matching cards, best first",
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
      maxOutputTokens: 400,
      ...(thinkingOff ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
    },
  };
}

/** The model's answer with its card numbers turned back into cards, or null when it is not usable. */
export function parseAnswer(
  body: unknown,
  cards: readonly FinderCard[],
): { reply: string; matches: FinderMatch[] } | null {
  const parts = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })
    ?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const content = parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");

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

export interface FinderOptions {
  apiKey: string;
  /** A Gemini model id. Defaults to DEFAULT_CHAT_MODEL. */
  model?: string | null;
  fetchImpl?: FetchLike;
}

/** Ask the model which cards fit the last question in `turns`. */
export async function findWords(
  turns: readonly ChatTurn[],
  cards: readonly FinderCard[],
  { apiKey, model, fetchImpl = fetch }: FinderOptions,
): Promise<FinderOutcome> {
  if (cards.length === 0) return { ok: false, reason: "no-cards" };
  const chosen = model?.trim() || DEFAULT_CHAT_MODEL;

  const ask = (thinkingOff: boolean) =>
    fetchImpl(`${ENDPOINT}/${encodeURIComponent(chosen)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(buildRequest(turns, cards, thinkingOff)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  try {
    let response = await ask(true);
    // Larger models refuse minimal thinking. Ask again with their own default.
    if (response.status === 400) response = await ask(false);
    if (!response.ok) {
      // 429 is the free allowance used up for now; 400 or 403 a key or model problem.
      console.warn(`Gemini answered ${response.status} for ${chosen}; the word finder could not answer.`);
      return { ok: false, reason: "failed" };
    }
    const answer = parseAnswer(await response.json(), cards);
    return answer ? { ok: true, ...answer } : { ok: false, reason: "failed" };
  } catch {
    // A timeout or a network error.
    return { ok: false, reason: "failed" };
  }
}
