import type { FetchLike } from "@/lib/transcript-sources";

/**
 * A word read aloud by one of Google's Gemini voices, which sound far more
 * like a person than the voices built into phones and browsers. Free with a
 * key from Google AI Studio (GEMINI_API_KEY), within a daily allowance.
 *
 * Nothing is kept here: the phone keeps each clip it gets (see public/sw.js),
 * so a word is asked for once per device and plays from the phone after that.
 * Without a key, or when Google fails, the app falls back to the device's own
 * voice.
 */

/** Google's quick text-to-speech model, on the free tier. GEMINI_VOICE_MODEL picks another. */
export const DEFAULT_VOICE_MODEL = "gemini-3.8-flash-lite-tts";
/**
 * Asked when the first model says its allowance is used up. The free tier
 * allows three requests a minute for each model, counted apart, so a second
 * model doubles what a quick run of taps can get.
 */
export const SPARE_VOICE_MODEL = "gemini-3.8-flash-tts";
/** "Firm": clear and even, good for single words. GEMINI_VOICE picks any of the 30. */
export const DEFAULT_VOICE = "Kore";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/**
 * Usually two or three seconds, now and then over ten. The app stops waiting
 * sooner and speaks with the device, but a slow clip still reaches the phone,
 * which keeps it for the next tap on that word.
 */
const TIMEOUT_MS = 20_000;

/** Whether the AI voice is set up. Pages pass this to the speaker buttons. */
export function aiVoiceReady(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export interface VoiceOptions {
  apiKey: string;
  model?: string | null;
  voice?: string | null;
  fetchImpl?: FetchLike;
}

// --- WAV ---------------------------------------------------------------------

interface Pcm {
  sampleRate: number;
  samples: Buffer;
}

/** A mono 16-bit PCM WAV around `samples`. */
export function wavFile({ sampleRate, samples }: Pcm): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

/** The samples of a mono 16-bit PCM WAV, or null for any other kind of file. */
function readWav(file: Buffer): Pcm | null {
  if (file.length < 12 || file.toString("ascii", 0, 4) !== "RIFF" || file.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let sampleRate = 0;
  let pcm16Mono = false;
  for (let at = 12; at + 8 <= file.length; ) {
    const id = file.toString("ascii", at, at + 4);
    const size = file.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && body + 16 <= file.length) {
      pcm16Mono =
        file.readUInt16LE(body) === 1 && file.readUInt16LE(body + 2) === 1 && file.readUInt16LE(body + 14) === 16;
      sampleRate = file.readUInt32LE(body + 4);
    } else if (id === "data") {
      if (!pcm16Mono || sampleRate === 0) return null;
      // Streamed WAVs can claim a larger size than they have; take what is there.
      const end = Math.min(body + size, file.length);
      return { sampleRate, samples: file.subarray(body, end - ((end - body) % 2)) };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** Quieter than this counts as silence: about -36 dB. */
const SILENCE = 520;
/** Kept either side of the sound, so the word is not clipped. */
const MARGIN_SECONDS = 0.06;

/**
 * Cut the silence before and after the word. The voice pads its answers,
 * often to twice the length of the word, which would only delay playback
 * and take up room on the phone. A file it cannot read comes back untouched.
 */
export function trimSilence(file: Buffer): Buffer {
  const wav = readWav(file);
  if (!wav) return file;
  const { samples, sampleRate } = wav;
  const count = samples.length / 2;

  let first = 0;
  while (first < count && Math.abs(samples.readInt16LE(first * 2)) < SILENCE) first += 1;
  if (first === count) return file; // All silence: leave it be.
  let last = count - 1;
  while (last > first && Math.abs(samples.readInt16LE(last * 2)) < SILENCE) last -= 1;

  const margin = Math.round(sampleRate * MARGIN_SECONDS);
  const start = Math.max(0, first - margin);
  const end = Math.min(count, last + 1 + margin);
  return wavFile({ sampleRate, samples: samples.subarray(start * 2, end * 2) });
}

// --- Gemini ------------------------------------------------------------------

/** The rate in a mime type like "audio/L16;codec=pcm;rate=24000", 24 kHz when it does not say. */
function rateOf(mimeType: string): number {
  const rate = Number(/rate=(\d+)/i.exec(mimeType)?.[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : 24000;
}

/** The WAV in Gemini's answer, trimmed, or null when there is none. Raw PCM is wrapped as WAV. */
export function audioFrom(body: unknown): Buffer | null {
  const parts = (body as { candidates?: Array<{ content?: { parts?: unknown[] } }> })?.candidates?.[0]?.content
    ?.parts;
  if (!Array.isArray(parts)) return null;

  for (const part of parts) {
    const inline = (part as { inlineData?: { data?: unknown; mimeType?: unknown } })?.inlineData;
    if (typeof inline?.data !== "string" || inline.data === "") continue;
    const bytes = Buffer.from(inline.data, "base64");
    const mimeType = typeof inline.mimeType === "string" ? inline.mimeType : "";
    const wav =
      bytes.toString("ascii", 0, 4) === "RIFF"
        ? bytes
        : wavFile({ sampleRate: rateOf(mimeType), samples: bytes.subarray(0, bytes.length - (bytes.length % 2)) });
    return trimSilence(wav);
  }
  return null;
}

/** One model's go at `text`: the WAV, or the status that says why not (0 for no answer at all). */
async function ask(
  text: string,
  model: string,
  { apiKey, voice, fetchImpl = fetch }: VoiceOptions,
): Promise<{ audio: Buffer | null; status: number }> {
  try {
    const response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice?.trim() || DEFAULT_VOICE } } },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { audio: null, status: response.status };
    return { audio: audioFrom(await response.json()), status: response.status };
  } catch {
    // A timeout or a network error.
    return { audio: null, status: 0 };
  }
}

/**
 * Ask Gemini to say `text`. The WAV, or null on any failure. When the chosen
 * model's allowance is used up for the minute, the spare model is asked.
 */
export async function synthesize(text: string, options: VoiceOptions): Promise<Buffer | null> {
  const chosen = options.model?.trim() || DEFAULT_VOICE_MODEL;
  let tried = chosen;
  let result = await ask(text, chosen, options);
  if (result.status === 429 && chosen !== SPARE_VOICE_MODEL) {
    tried = SPARE_VOICE_MODEL;
    result = await ask(text, SPARE_VOICE_MODEL, options);
  }
  if (!result.audio) {
    // 429 is the free allowance used up for now; 400 or 403 a key or model problem.
    console.warn(
      result.status === 0
        ? `Gemini did not answer in time for ${tried}; using the device's voice instead.`
        : `Gemini answered ${result.status} for ${tried} without audio; using the device's voice instead.`,
    );
  }
  return result.audio;
}

/**
 * Clips being made right now, by voice and text. A request for a word that
 * arrives while Google is still making it -- the audio player asking twice,
 * say -- shares that answer instead of asking Google a second time.
 */
const underWay = new Map<string, Promise<Buffer | null>>();

/** `text` read aloud by Gemini. Null when the voice fails. Nothing is kept once it is sent. */
export function pronunciationOf(text: string, options: VoiceOptions): Promise<Buffer | null> {
  const voice = options.voice?.trim() || DEFAULT_VOICE;
  const key = `${voice}\n${text}`;
  const known = underWay.get(key);
  if (known) return known;

  const answer = synthesize(text, { ...options, voice }).finally(() => underWay.delete(key));
  underWay.set(key, answer);
  return answer;
}
