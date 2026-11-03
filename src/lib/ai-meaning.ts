import { lookupWord, type DictionaryEntry, type LookupOutcome } from "@/lib/dictionary";
import type { FetchLike } from "@/lib/transcript-sources";

/**
 * A word's meaning in the sentence it was heard in, from a small AI model
 * through OpenRouter. A dictionary lists every sense of "bank"; the model
 * picks the one the video meant and says it simply.
 *
 * Only used when OPENROUTER_API_KEY is set. Without it, or when the model is
 * slow or fails, the free dictionaries answer as before.
 */

/**
 * The quickest of the small models tried (under a second a word, against
 * about 1.3 s for Claude Haiku 5.5), with meanings as good. It can also answer
 * without "thinking" first, which many small models cannot switch off.
 * Any OpenRouter model id works in OPENROUTER_MODEL.
 */
export const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
/** Past this the dictionary is quicker; the sheet should not sit and spin. */
const TIMEOUT_MS = 6000;
const MAX_WORD = 60;
const MAX_MEANING = 300;
/** A transcript line is short; anything longer is cut rather than sent. */
const MAX_SENTENCE = 600;

const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "determiner",
  "phrasal verb",
  "idiom",
  "phrase",
  "name",
] as const;

const INSTRUCTIONS = `You help someone learning English while they watch a video. They tapped a word or short phrase in the transcript. Answer for the way it is used in that sentence.

- word: the form to save on a flashcard. The dictionary form: singular for nouns, the base verb ("give up" for "gave up", "run" for "running"). Keep a phrase as a phrase. Lowercase unless it is a name.
- partOfSpeech: what it is in this sentence.
- meaning: what it means here, in plain, simple English a learner understands. At most 15 words. Do not use the word itself or any form of it. No full stop at the end.

The transcript may come from automatic captions and have mistakes; go by the most likely meaning.`;

const SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string", description: "Dictionary form to put on the flashcard" },
    partOfSpeech: {
      type: "string",
      enum: PARTS_OF_SPEECH,
      description: "Its part of speech in this sentence",
    },
    meaning: { type: "string", description: "Simple meaning in this sentence, at most 15 words" },
  },
  required: ["word", "partOfSpeech", "meaning"],
  additionalProperties: false,
} as const;

export interface AiOptions {
  apiKey: string;
  /** An OpenRouter model id. Defaults to DEFAULT_MODEL. */
  model?: string | null;
  fetchImpl?: FetchLike;
}

/** The request OpenRouter is sent. Thinking is turned off, since it only adds wait here. */
export function buildRequest(word: string, sentence: string, model: string, reasoningOff: boolean) {
  return {
    model,
    messages: [
      { role: "system", content: INSTRUCTIONS },
      {
        role: "user",
        content: `<word>${word}</word>\n<sentence>${sentence || word}</sentence>`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "word_meaning", strict: true, schema: SCHEMA },
    },
    max_tokens: 200,
    ...(reasoningOff ? { reasoning: { effort: "none" } } : {}),
    // The quickest provider of the model at the moment, among those that
    // honour every setting above. So add nothing here a provider may not take:
    // some models' providers refuse `temperature`, and asking for it leaves none.
    provider: { sort: "latency", require_parameters: true },
  };
}

/** The model's answer as a one-meaning dictionary entry, or null when it is not usable. */
export function parseAnswer(body: unknown): DictionaryEntry | null {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
    ?.content;
  if (typeof content !== "string") return null;

  let answer: { word?: unknown; partOfSpeech?: unknown; meaning?: unknown };
  try {
    // Some models wrap JSON in a code fence even when asked for a schema.
    answer = JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    return null;
  }

  const word = typeof answer.word === "string" ? answer.word.trim() : "";
  const meaning = typeof answer.meaning === "string" ? answer.meaning.trim().replace(/\.$/, "") : "";
  const part = typeof answer.partOfSpeech === "string" ? answer.partOfSpeech.trim().toLowerCase() : "";
  if (word === "" || word.length > MAX_WORD || meaning === "" || meaning.length > MAX_MEANING) return null;

  return {
    word,
    phonetic: null,
    audio: null,
    meanings: [{ partOfSpeech: part || "word", definitions: [{ definition: meaning, example: null }] }],
    inContext: true,
  };
}

/**
 * Ask the model what a word means in its sentence. Null on any failure, so
 * the caller can fall back to the dictionary.
 */
export async function explainWord(
  word: string,
  sentence: string,
  { apiKey, model, fetchImpl = fetch }: AiOptions,
): Promise<DictionaryEntry | null> {
  const chosen = model?.trim() || DEFAULT_MODEL;
  const context = sentence.replace(/\s+/g, " ").trim().slice(0, MAX_SENTENCE);

  const ask = (reasoningOff: boolean) =>
    fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(buildRequest(word, context, chosen, reasoningOff)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  try {
    let response = await ask(true);
    // Some models must think and refuse a request that turns it off. Ask again without.
    if (response.status === 400) response = await ask(false);
    if (!response.ok) {
      // 401 is a wrong key, 402 an account out of credit. Worth seeing in the logs.
      console.warn(`OpenRouter answered ${response.status} for ${chosen}; using the dictionary instead.`);
      return null;
    }
    return parseAnswer(await response.json());
  } catch {
    // A timeout or a network error.
    return null;
  }
}

/**
 * What a tapped word means: the AI's reading of it in its sentence when a key
 * is set, the dictionaries otherwise or when the AI fails.
 */
export async function defineInContext(
  word: string,
  sentence: string,
  options: { apiKey: string | null; model?: string | null; fetchImpl?: FetchLike },
): Promise<LookupOutcome> {
  if (options.apiKey) {
    const entry = await explainWord(word, sentence, { ...options, apiKey: options.apiKey });
    if (entry) return { ok: true, entry };
  }
  return lookupWord(word, options.fetchImpl);
}
