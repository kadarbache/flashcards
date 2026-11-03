import { auth } from "@/auth";
import { pronunciationOf } from "@/lib/pronunciation";
import { speakableText } from "@/lib/speakable";

/**
 * GET /api/speech?text=essence
 *
 * A word read aloud by the AI voice, as a WAV. Nothing is kept on the server:
 * the phone keeps each clip (public/sw.js), so it asks for a word once.
 * Answers 404 when no voice is set up and 503 when the voice fails, and the
 * app then speaks with the device's own voice.
 */
export async function GET(request: Request) {
  // The proxy sends visitors to the login page; this is the check that counts.
  const session = await auth();
  if (!session?.user) return new Response(null, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return new Response(null, { status: 404 });

  const text = speakableText(new URL(request.url).searchParams.get("text"));
  if (!text) return new Response(null, { status: 400 });

  const audio = await pronunciationOf(text, {
    apiKey,
    model: process.env.GEMINI_VOICE_MODEL,
    voice: process.env.GEMINI_VOICE,
  });
  if (!audio) return new Response(null, { status: 503 });

  return new Response(new Uint8Array(audio), {
    headers: {
      "content-type": "audio/wav",
      "content-length": String(audio.length),
      // A word sounds the same next year. This lets the browser's own cache
      // keep it too, where the service worker is not running yet.
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
