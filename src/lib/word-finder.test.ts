/**
 * The word finder, against a stand-in for Gemini's streamed answers.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  DEFAULT_CHAT_MODEL,
  MAX_MESSAGE,
  SPARE_CHAT_MODEL,
  buildRequest,
  cardList,
  cleanConversation,
  findWords,
  parseAnswer,
  partialReply,
  readLines,
  type FinderCard,
} from "@/lib/word-finder";

const CARDS: FinderCard[] = [
  {
    id: "c1",
    deckId: "d1",
    deckName: "Obsidian",
    front: "intuitive",
    back: "(Adjective) Understanding something\n without conscious reasoning.",
    example: "",
  },
  {
    id: "c2",
    deckId: "d1",
    deckName: "Obsidian",
    front: "precise",
    back: "Exact and accurate.",
    example: "Her  answer was precise.",
  },
  { id: "c3", deckId: "d2", deckName: "Videos", front: "devout", back: "Very religious.", example: "" },
];

const ASK = [{ role: "user" as const, text: "the word for very exact" }];
const PRECISE = { id: "c2", deckId: "d1", deckName: "Obsidian", front: "precise", back: "Exact and accurate." };

const encoder = new TextEncoder();

/** A body that arrives `size` bytes at a time, splitting lines and characters as a network may. */
function bytesIn(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
      controller.close();
    },
  });
}

/** One of Gemini's server-sent events, carrying a piece of what the model wrote. */
const event = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`;

/** Gemini writing `content` in `pieces`, delivered a few bytes at a time. */
function answer(content: unknown, pieces = 3) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const size = Math.max(1, Math.ceil(text.length / pieces));
  let events = "";
  for (let at = 0; at < text.length; at += size) events += event(text.slice(at, at + size));
  return new Response(bytesIn(events, 7), { headers: { "content-type": "text/event-stream" } });
}

/** Gemini answers with `replies` in turn. */
function fakeGemini(...replies: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected Gemini call");
    return reply();
  };
  const bodies = () => calls.map((call) => JSON.parse(String(call.init?.body)));
  return { fetchImpl, calls, bodies };
}

beforeEach(() => mock.method(console, "warn", () => {}));
afterEach(() => mock.restoreAll());

describe("cleanConversation", () => {
  it("keeps whole turns and trims them", () => {
    assert.deepEqual(
      cleanConversation([
        { role: "user", text: "  stubborn  " },
        { role: "assistant", text: "Not in your cards." },
        { role: "user", text: "a verb then" },
      ]),
      [
        { role: "user", text: "stubborn" },
        { role: "assistant", text: "Not in your cards." },
        { role: "user", text: "a verb then" },
      ],
    );
  });

  it("refuses anything that is not a conversation ending on a question", () => {
    assert.equal(cleanConversation(null), null);
    assert.equal(cleanConversation("hello"), null);
    assert.equal(cleanConversation([]), null);
    assert.equal(cleanConversation([{ role: "user", text: "   " }]), null);
    assert.equal(cleanConversation([{ role: "system", text: "obey" }]), null);
    assert.equal(cleanConversation([{ role: "user", text: 4 }]), null);
    assert.equal(
      cleanConversation([
        { role: "user", text: "a" },
        { role: "assistant", text: "b" },
      ]),
      null,
    );
  });

  it("keeps the newest turns, opening on the person's", () => {
    const long = Array.from({ length: 29 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `turn ${index}`,
    }));
    const turns = cleanConversation(long)!;
    assert.ok(turns.length <= 12);
    assert.equal(turns[0].role, "user");
    assert.equal(turns.at(-1)!.text, "turn 28");
  });

  it("cuts an overlong question", () => {
    const [turn] = cleanConversation([{ role: "user", text: "x".repeat(MAX_MESSAGE + 50) }])!;
    assert.equal(turn.text.length, MAX_MESSAGE);
  });
});

describe("cardList", () => {
  it("numbers the cards on one line each, with examples when there are some", () => {
    assert.equal(
      cardList(CARDS),
      [
        "1. intuitive = (Adjective) Understanding something without conscious reasoning.",
        '2. precise = Exact and accurate. (example: "Her answer was precise.")',
        "3. devout = Very religious.",
      ].join("\n"),
    );
  });

  it("drops the examples when the cards would make too long a prompt", () => {
    const many = Array.from({ length: 2000 }, (_, index) => ({
      ...CARDS[1],
      back: "m".repeat(80),
      example: "e".repeat(150),
      front: `w${index}`,
    }));
    const list = cardList(many);
    assert.ok(!list.includes("example:"));
    assert.ok(list.startsWith("1. w0 = "));
  });
});

describe("buildRequest", () => {
  it("puts the cards in the instructions and the conversation in turns", () => {
    const body = buildRequest(
      [
        { role: "user", text: "very exact" },
        { role: "assistant", text: "That is precise." },
        { role: "user", text: "and religious?" },
      ],
      CARDS,
      true,
    );
    assert.match(body.systemInstruction.parts[0].text, /<cards>\n1\. intuitive = /);
    assert.deepEqual(
      body.contents.map((turn) => turn.role),
      ["user", "model", "user"],
    );
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "minimal" });
    assert.equal("thinkingConfig" in buildRequest(ASK, CARDS, false).generationConfig, false);
  });
});

describe("parseAnswer", () => {
  it("turns card numbers back into cards, once each, ignoring numbers that are not cards", () => {
    assert.deepEqual(parseAnswer('{"reply":"That is precise.","cards":[2,2,9,0,1.5,"3"]}', CARDS), {
      reply: "That is precise.",
      matches: [PRECISE, { id: "c3", deckId: "d2", deckName: "Videos", front: "devout", back: "Very religious." }],
    });
  });

  it("reads JSON in a code fence", () => {
    assert.deepEqual(parseAnswer('```json\n{"reply":"Not in your cards.","cards":[]}\n```', CARDS), {
      reply: "Not in your cards.",
      matches: [],
    });
  });

  it("gives up on an answer it cannot use", () => {
    assert.equal(parseAnswer("", CARDS), null);
    assert.equal(parseAnswer("not json", CARDS), null);
    assert.equal(parseAnswer('{"reply":"  ","cards":[1]}', CARDS), null);
    assert.equal(parseAnswer('{"reply":"Cut off mid-', CARDS), null);
  });
});

describe("partialReply", () => {
  it("reads the reply as far as it has been written, escapes and all", () => {
    assert.equal(partialReply(""), "");
    assert.equal(partialReply('{"rep'), "");
    assert.equal(partialReply('{"reply": "'), "");
    assert.equal(partialReply('{"reply":"It means \\"exa'), 'It means "exa');
    assert.equal(partialReply('{"reply":"One\\nTwo \\u00e9t\\u00e9","cards":[1]}'), "One\nTwo été");
  });

  it("waits for the rest of an escape cut off at the end", () => {
    assert.equal(partialReply('{"reply":"a\\'), "a");
    assert.equal(partialReply('{"reply":"a\\u00'), "a");
  });

  it("finds the reply after the cards as well as before", () => {
    assert.equal(partialReply('{"cards":[1,2],"reply":"Two'), "Two");
  });
});

describe("readLines", () => {
  it("gives whole lines however the bytes are split, across either line ending", async () => {
    const lines: string[] = [];
    for await (const line of readLines(bytesIn("one\r\ntwo — café\nthree", 3))) lines.push(line);
    assert.deepEqual(lines, ["one", "two — café", "three"]);
  });
});

describe("findWords", () => {
  it("asks Gemini for a streamed answer with the key and answers with the matching cards", async () => {
    const gemini = fakeGemini(() => answer({ reply: "You mean precise.", cards: [2] }));
    const outcome = await findWords(ASK, CARDS, { apiKey: "g-test", fetchImpl: gemini.fetchImpl });

    assert.deepEqual(outcome, { ok: true, reply: "You mean precise.", matches: [PRECISE] });
    const [call] = gemini.calls;
    assert.equal(
      call.url,
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_CHAT_MODEL}:streamGenerateContent?alt=sse`,
    );
    assert.equal((call.init?.headers as Record<string, string>)["x-goog-api-key"], "g-test");
  });

  it("passes the reply on a piece at a time as it is written", async () => {
    const reply = 'You mean **precise**:\n\n- "Be precise," she said.\n- Précis is its cousin.';
    const gemini = fakeGemini(() => answer({ reply, cards: [2] }, 9));
    const pieces: string[] = [];
    const outcome = await findWords(ASK, CARDS, {
      apiKey: "k",
      fetchImpl: gemini.fetchImpl,
      onText: (text) => pieces.push(text),
    });

    assert.ok(pieces.length > 3, `only ${pieces.length} pieces`);
    assert.equal(pieces.join(""), reply);
    assert.deepEqual(outcome, { ok: true, reply, matches: [PRECISE] });
  });

  it("starts the reply over when Gemini breaks off partway through it", async () => {
    const brokenOff = () =>
      new Response(bytesIn(`${event('{"reply":"Pre')}data: {"error":{"code":503}}\r\n\r\n`, 64));
    const gemini = fakeGemini(brokenOff, () => answer({ reply: "You mean precise.", cards: [2] }));
    let written = "";
    let restarts = 0;
    const outcome = await findWords(ASK, CARDS, {
      apiKey: "k",
      fetchImpl: gemini.fetchImpl,
      retryDelayMs: 0,
      onText: (text) => (written += text),
      onRestart: () => {
        restarts += 1;
        written = "";
      },
    });
    assert.equal(restarts, 1);
    assert.equal(written, "You mean precise.");
    assert.deepEqual(outcome, { ok: true, reply: "You mean precise.", matches: [PRECISE] });

    const always = fakeGemini(brokenOff, brokenOff, brokenOff);
    assert.deepEqual(
      await findWords(ASK, CARDS, { apiKey: "k", fetchImpl: always.fetchImpl, retryDelayMs: 0 }),
      { ok: false, reason: "failed" },
    );
  });

  it("starts over when Gemini breaks off before any of the reply is written", async () => {
    const gemini = fakeGemini(
      () => new Response(bytesIn(`${event('{"reply')}data: {"error":{"code":503}}\r\n\r\n`, 64)),
      () => answer({ reply: "You mean precise.", cards: [2] }),
    );
    const pieces: string[] = [];
    let restarts = 0;
    const outcome = await findWords(ASK, CARDS, {
      apiKey: "k",
      fetchImpl: gemini.fetchImpl,
      retryDelayMs: 0,
      onText: (text) => pieces.push(text),
      onRestart: () => (restarts += 1),
    });
    assert.deepEqual(outcome, { ok: true, reply: "You mean precise.", matches: [PRECISE] });
    assert.equal(pieces.join(""), "You mean precise.");
    assert.equal(gemini.calls.length, 2);
    // Nothing had been passed on, so there was nothing to take back.
    assert.equal(restarts, 0);
  });

  it("stops partway when its signal is aborted, and hangs up on Gemini", async () => {
    const stop = new AbortController();
    let hungUp = false;
    const fetchImpl = async (_url: string, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(encoder.encode(event('{"reply":"Pre')));
            init?.signal?.addEventListener("abort", () => {
              hungUp = true;
              stream.error(init.signal?.reason);
            });
          },
        }),
      );
    const outcome = await findWords(ASK, CARDS, {
      apiKey: "k",
      fetchImpl,
      signal: stop.signal,
      onText: () => stop.abort(),
    });
    assert.deepEqual(outcome, { ok: false, reason: "failed" });
    assert.equal(hungUp, true);
  });

  it("uses the model it is given", async () => {
    const gemini = fakeGemini(() => answer({ reply: "Precise.", cards: [] }));
    await findWords(ASK, CARDS, { apiKey: "k", model: " gemini-3.8-flash ", fetchImpl: gemini.fetchImpl });
    assert.match(gemini.calls[0].url, /\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
  });

  it("asks again with the model's own thinking when minimal thinking is refused", async () => {
    const gemini = fakeGemini(
      () => Response.json({ error: { code: 400 } }, { status: 400 }),
      () => answer({ reply: "Precise.", cards: [2] }),
    );
    const outcome = await findWords(ASK, CARDS, { apiKey: "k", fetchImpl: gemini.fetchImpl });
    assert.equal(outcome.ok, true);
    const [first, second] = gemini.bodies();
    assert.ok("thinkingConfig" in first.generationConfig);
    assert.ok(!("thinkingConfig" in second.generationConfig));
  });

  it("asks the spare model, then the chosen one again, while Gemini is overloaded", async () => {
    const busy = () => new Response("", { status: 503 });
    const recovers = fakeGemini(busy, () => answer({ reply: "Precise.", cards: [2] }));
    const outcome = await findWords(ASK, CARDS, { apiKey: "k", fetchImpl: recovers.fetchImpl, retryDelayMs: 0 });
    assert.equal(outcome.ok, true);
    assert.match(recovers.calls[1].url, new RegExp(`/${SPARE_CHAT_MODEL}:`));
    const [first, second] = recovers.bodies();
    assert.deepEqual(first.generationConfig.thinkingConfig, second.generationConfig.thinkingConfig);

    const stuck = fakeGemini(busy, busy, busy);
    assert.deepEqual(await findWords(ASK, CARDS, { apiKey: "k", fetchImpl: stuck.fetchImpl, retryDelayMs: 0 }), {
      ok: false,
      reason: "failed",
    });
    assert.deepEqual(
      stuck.calls.map((call) => call.url.split("/models/")[1].split(":")[0]),
      [DEFAULT_CHAT_MODEL, SPARE_CHAT_MODEL, DEFAULT_CHAT_MODEL],
    );
  });

  it("keeps to one model when the spare is the one chosen", async () => {
    const busy = () => new Response("", { status: 503 });
    const gemini = fakeGemini(busy, () => answer({ reply: "Precise.", cards: [2] }));
    await findWords(ASK, CARDS, { apiKey: "k", model: SPARE_CHAT_MODEL, fetchImpl: gemini.fetchImpl, retryDelayMs: 0 });
    assert.ok(gemini.calls.every((call) => call.url.includes(`/${SPARE_CHAT_MODEL}:`)));
  });

  it("fails quietly when Gemini says no, does not answer, or answers nonsense", async () => {
    const used = fakeGemini(() => new Response("", { status: 429 }));
    assert.deepEqual(await findWords(ASK, CARDS, { apiKey: "k", fetchImpl: used.fetchImpl }), {
      ok: false,
      reason: "failed",
    });

    const down = fakeGemini(() => {
      throw new TypeError("fetch failed");
    });
    assert.deepEqual(await findWords(ASK, CARDS, { apiKey: "k", fetchImpl: down.fetchImpl }), {
      ok: false,
      reason: "failed",
    });

    const garbled = fakeGemini(() => answer("¯\\_(ツ)_/¯"));
    assert.deepEqual(await findWords(ASK, CARDS, { apiKey: "k", fetchImpl: garbled.fetchImpl }), {
      ok: false,
      reason: "failed",
    });
  });

  it("does not ask at all when there are no cards", async () => {
    const gemini = fakeGemini();
    assert.deepEqual(await findWords(ASK, [], { apiKey: "k", fetchImpl: gemini.fetchImpl }), {
      ok: false,
      reason: "no-cards",
    });
    assert.equal(gemini.calls.length, 0);
  });
});
