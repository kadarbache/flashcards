import { auth } from "@/auth";
import { cleanConversation, findWords, type FinderEvent } from "@/lib/word-finder";
import { loadFinderCards } from "@/lib/word-finder-db";

/**
 * POST /find/chat with `{ conversation: [{ role, text }, …] }`
 *
 * The answer to the last question, streamed as it is written, one JSON object
 * per line (see FinderEvent): `{"text": …}` for each new piece of the reply,
 * then `{"done": true, "reply": …, "matches": […]}` with the cards, or
 * `{"error": …}` when there is no answer. `{"restart": true}` means Gemini
 * broke off and is being asked again, so the text so far goes. Leaving the
 * page stops it, and Gemini with it.
 */
export async function POST(request: Request) {
  // The proxy sends visitors to the login page; this is the check that counts.
  const session = await auth();
  if (!session?.user) return new Response(null, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const turns = cleanConversation((body as { conversation?: unknown } | null)?.conversation);
  const apiKey = process.env.GEMINI_API_KEY;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: FinderEvent) => {
        // Once the page has hung up there is no one to send to.
        if (request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };

      if (!turns) send({ error: "bad-question" });
      else if (!apiKey) send({ error: "no-key" });
      else {
        try {
          const cards = await loadFinderCards();
          const outcome = await findWords(turns, cards, {
            apiKey,
            model: process.env.GEMINI_CHAT_MODEL,
            signal: request.signal,
            onText: (text) => send({ text }),
            onRestart: () => send({ restart: true }),
          });
          send(outcome.ok ? { done: true, reply: outcome.reply, matches: outcome.matches } : { error: outcome.reason });
        } catch {
          // The cards could not be read.
          send({ error: "failed" });
        }
      }

      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // Pass each line on as it comes, through any cache or proxy on the way.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
