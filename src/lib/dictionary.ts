import { decodeEntities, normalizeWord } from "@/lib/transcript";
import type { FetchLike } from "@/lib/transcript-sources";

/**
 * English word lookups: the Free Dictionary API (dictionaryapi.dev) first,
 * Wiktionary when that is down or has nothing. Neither needs a key.
 */

export interface Definition {
  definition: string;
  example: string | null;
}

export interface Meaning {
  partOfSpeech: string;
  definitions: Definition[];
}

export interface DictionaryEntry {
  /** The word the entry is for. Can differ from what was clicked: "running" finds "run". */
  word: string;
  phonetic: string | null;
  /** A recording of the word, when the dictionary has one. */
  audio: string | null;
  meanings: Meaning[];
}

export type LookupOutcome =
  { ok: true; entry: DictionaryEntry } | { ok: false; reason: "not-found" | "failed" };

const API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const MAX_MEANINGS = 4;
const MAX_DEFINITIONS = 3;

const VOWEL = /[aeiou]/;

/**
 * Forms to try, in order, when the word as clicked is not in the dictionary:
 * "cities" -> "city", "stopped" -> "stop", "making" -> "make".
 * Guesses, not grammar -- a miss just means one more request.
 */
export function wordCandidates(raw: string): string[] {
  const word = normalizeWord(raw).replace(/'s$|s'$/, (end) => (end === "s'" ? "s" : ""));
  if (word === "") return [];
  const out = [word];
  const add = (form: string) => {
    if (form.length >= 2 && VOWEL.test(form) && !out.includes(form)) out.push(form);
  };
  const undouble = (stem: string) =>
    /([b-df-hj-np-tv-z])\1$/.test(stem) && !/(ll|ss|ff|zz)$/.test(stem) ? stem.slice(0, -1) : null;

  if (word.endsWith("ies")) add(`${word.slice(0, -3)}y`);
  // "boxes" -> "box", but "makes" -> "make", not "mak".
  if (/(s|x|z|ch|sh|o)es$/.test(word)) add(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss")) add(word.slice(0, -1));
  if (word.endsWith("ied")) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("ed")) {
    const stem = word.slice(0, -2);
    const single = undouble(stem);
    if (single) add(single);
    add(stem);
    add(word.slice(0, -1));
  }
  if (word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    const single = undouble(stem);
    if (single) add(single);
    add(stem);
    add(`${stem}e`);
  }
  if (word.endsWith("ly")) add(word.slice(0, -2));
  return out.slice(0, 5);
}

type ApiEntry = {
  word?: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
};

/** Merge the API's entries into one: meanings grouped by part of speech, the first few of each. */
export function toEntry(word: string, entries: ApiEntry[]): DictionaryEntry | null {
  const byPart = new Map<string, Definition[]>();
  for (const entry of entries) {
    for (const meaning of entry.meanings ?? []) {
      const part = meaning.partOfSpeech?.trim() || "word";
      const list = byPart.get(part) ?? [];
      for (const definition of meaning.definitions ?? []) {
        const text = definition.definition?.trim();
        if (!text || list.some((existing) => existing.definition === text)) continue;
        list.push({ definition: text, example: definition.example?.trim() || null });
      }
      byPart.set(part, list);
    }
  }

  const meanings = [...byPart]
    .filter(([, definitions]) => definitions.length > 0)
    .slice(0, MAX_MEANINGS)
    .map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions: definitions.slice(0, MAX_DEFINITIONS),
    }));
  if (meanings.length === 0) return null;

  const phonetics = entries.flatMap((entry) => entry.phonetics ?? []);
  const phonetic =
    entries.find((entry) => entry.phonetic)?.phonetic ?? phonetics.find((item) => item.text)?.text ?? null;
  const audio = phonetics.find((item) => item.audio?.startsWith("https://"))?.audio ?? null;

  return { word: entries[0]?.word ?? word, phonetic, audio, meanings };
}

/**
 * Wiktionary's definitions come as HTML. "Form of" definitions ("plural of
 * stranger") are set aside: they point at the word worth showing instead.
 */
type WiktionaryDefinition = {
  definition?: string;
  parsedExamples?: Array<{ example?: string }>;
  examples?: string[];
};
type WiktionaryBody = Record<string, Array<{ partOfSpeech?: string; definitions?: WiktionaryDefinition[] }>>;

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The entry, or the base word it points at when it is only a form of another.
 *
 * "strangers" has nothing but "plural of stranger", so the lookup moves on to
 * "stranger". "went" also has a meaning of its own, so it is shown, with
 * "simple past of go" among its definitions.
 */
export function fromWiktionary(
  word: string,
  body: WiktionaryBody,
  /** Put this part of speech first: "strangers" is a plural noun, so "stranger" the noun leads. */
  prefer: string | null = null,
): { entry: DictionaryEntry | null; lemma: string | null; lemmaPart: string | null } {
  let lemma: string | null = null;
  let lemmaPart: string | null = null;
  let ownMeanings = 0;
  // A word with two origins has two "Verb" sections; they show as one.
  const byPart = new Map<string, Definition[]>();
  for (const section of body.en ?? []) {
    const part = (section.partOfSpeech ?? "word").toLowerCase();
    const definitions = byPart.get(part) ?? [];
    byPart.set(part, definitions);
    for (const item of section.definitions ?? []) {
      const html = item.definition ?? "";
      if (/form-of-definition/.test(html)) {
        const target = /form-of-definition-link[\s\S]*?<a\b[^>]*\btitle="([^"]+)"/.exec(html)?.[1] ?? null;
        if (target && !lemma) {
          lemma = target;
          lemmaPart = (section.partOfSpeech ?? "").toLowerCase() || null;
        }
      } else {
        ownMeanings += 1;
      }
      const text = htmlToText(html);
      if (text === "" || definitions.some((existing) => existing.definition === text)) continue;
      const example = item.parsedExamples?.[0]?.example ?? item.examples?.[0] ?? "";
      definitions.push({ definition: text, example: htmlToText(example) || null });
    }
  }
  const meanings: Meaning[] = [...byPart]
    .filter(([, definitions]) => definitions.length > 0)
    .map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions: definitions.slice(0, MAX_DEFINITIONS),
    }));
  const base = lemma ? decodeEntities(lemma).toLowerCase() : null;
  if (ownMeanings === 0 && base && base !== word) return { entry: null, lemma: base, lemmaPart };
  if (prefer) {
    meanings.sort((a, b) => Number(b.partOfSpeech === prefer) - Number(a.partOfSpeech === prefer));
  }
  return {
    entry:
      meanings.length > 0
        ? { word, phonetic: null, audio: null, meanings: meanings.slice(0, MAX_MEANINGS) }
        : null,
    lemma: base,
    lemmaPart,
  };
}

const WIKTIONARY = "https://en.wiktionary.org/api/rest_v1/page/definition/";
/** Wikimedia asks every client to say who it is. */
const USER_AGENT = "Flashcards/1.0 (personal vocabulary app)";
/** The free dictionary is volunteer-run and sometimes hangs; do not wait on it long. */
const TIMEOUT_MS = 4000;
const MAX_REQUESTS = 10;
/** After the Free Dictionary fails, go straight to Wiktionary for this long. */
const COOL_OFF_MS = 5 * 60_000;

/** When the Free Dictionary may be tried again. Kept per server process. */
let freeDictionaryRestsUntil = 0;

/** Forget that the Free Dictionary was down. For tests. */
export function resetDictionaryHealth(): void {
  freeDictionaryRestsUntil = 0;
}

type Attempt =
  | { kind: "found"; entry: DictionaryEntry }
  | { kind: "missing"; lemma?: string | null; lemmaPart?: string | null }
  | { kind: "error" };

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>) {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404) return { missing: true as const };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { missing: false as const, body: (await response.json()) as unknown };
}

async function tryFreeDictionary(fetchImpl: FetchLike, word: string): Promise<Attempt> {
  try {
    const result = await getJson(fetchImpl, `${API}${encodeURIComponent(word)}`, {
      accept: "application/json",
    });
    if (result.missing) return { kind: "missing" };
    const entry = Array.isArray(result.body) ? toEntry(word, result.body as ApiEntry[]) : null;
    return entry ? { kind: "found", entry } : { kind: "missing" };
  } catch {
    return { kind: "error" };
  }
}

async function tryWiktionary(fetchImpl: FetchLike, word: string, prefer: string | null): Promise<Attempt> {
  try {
    const result = await getJson(fetchImpl, `${WIKTIONARY}${encodeURIComponent(word.replace(/ /g, "_"))}`, {
      accept: "application/json",
      "user-agent": USER_AGENT,
    });
    if (result.missing) return { kind: "missing" };
    const { entry, lemma, lemmaPart } = fromWiktionary(word, (result.body ?? {}) as WiktionaryBody, prefer);
    return entry ? { kind: "found", entry } : { kind: "missing", lemma, lemmaPart };
  } catch {
    return { kind: "error" };
  }
}

/**
 * Look a word up, trying its likely base forms when the exact word is missing.
 *
 * The Free Dictionary is asked first: its entries are tidy and come with a
 * pronunciation. It is run by volunteers and goes down from time to time, so
 * Wiktionary is the fallback -- for an outage, and for words and phrases the
 * Free Dictionary does not have ("give up").
 */
export async function lookupWord(
  raw: string,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<LookupOutcome> {
  const candidates = wordCandidates(raw);
  if (candidates.length === 0) return { ok: false, reason: "not-found" };

  let requests = 0;
  let errors = 0;

  for (const candidate of now() < freeDictionaryRestsUntil ? [] : candidates) {
    if (requests >= MAX_REQUESTS) break;
    requests += 1;
    const attempt = await tryFreeDictionary(fetchImpl, candidate);
    if (attempt.kind === "found") return { ok: true, entry: attempt.entry };
    if (attempt.kind === "error") {
      // Down, most likely: every other word would fail the same way, and
      // waiting out its timeout on each click makes the sheet feel broken.
      errors += 1;
      freeDictionaryRestsUntil = now() + COOL_OFF_MS;
      break;
    }
  }

  type Next = { word: string; prefer: string | null };
  const queue: Next[] = candidates.map((word) => ({ word, prefer: null }));
  const tried = new Set<string>();
  while (queue.length > 0 && requests < MAX_REQUESTS) {
    const { word: candidate, prefer } = queue.shift() as Next;
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    requests += 1;
    const attempt = await tryWiktionary(fetchImpl, candidate, prefer);
    if (attempt.kind === "found") return { ok: true, entry: attempt.entry };
    if (attempt.kind === "error") errors += 1;
    if (attempt.kind === "missing" && attempt.lemma) {
      queue.unshift({ word: attempt.lemma, prefer: attempt.lemmaPart ?? null });
    }
  }

  // Only "not found" when somebody actually answered that the word is missing.
  return { ok: false, reason: errors > 0 && errors >= requests ? "failed" : "not-found" };
}
