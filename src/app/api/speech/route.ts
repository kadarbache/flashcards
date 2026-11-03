import { auth } from "@/auth";
import { pronunciationOf } from "@/lib/pronunciation";
import { speakableText } from "@/lib/speakable";

/**
 * GET /api/speech?text=essence
 *
 * A word read aloud by the AI voice, as a WAV. Each word is made once and
 * then served from the database. Answers 404 when no voice is set up and 503
 * when the voice fails, and the app then speaks with the device's own voice.
 */
export async function GET(request: Request) {
  // The proxy sends visitors to the login page; this is the check that counts.
  const session = await auth();
  if (!session?.user) return new Response(null, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return new Response(null, { status: 404 });

  const text = speakableText(new URL(request.url).searchParams.get("text"));
  if (!text) return new Response(null, { status: 400 });

  let audio: Buffer | null = null;
  try {
    audio = await pronunciationOf(text, {
      apiKey,
      model: process.env.GEMINI_VOICE_MODEL,
      voice: process.env.GEMINI_VOICE,
    });
  } catch (error) {
    console.warn("Could not read the saved pronunciation:", error);
  }
  if (!audio) return new Response(null, { status: 503 });

  return new Response(new Uint8Array(audio), {
    headers: {
      "content-type": "audio/wav",
      "content-length": String(audio.length),
      // A word sounds the same tomorrow. A week, so a new GEMINI_VOICE shows up in time.
      "cache-control": "private, max-age=604800",
    },
  });
}
