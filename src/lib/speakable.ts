/** Longer than this is a sentence, not a word to hear. */
const MAX_TEXT = 60;

/**
 * What the AI voice may read aloud: a word or short phrase, as a flashcard
 * would show it, tidied. Anything else is refused, so the voice cannot be
 * borrowed to read out arbitrary text. The server enforces it; the app checks
 * first, so it does not ask for a clip it would be refused.
 */
export function speakableText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.normalize("NFC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  if (text === "" || text.length > MAX_TEXT) return null;
  return /^\p{L}[\p{L}\p{M}' .-]*$/u.test(text) ? text : null;
}
