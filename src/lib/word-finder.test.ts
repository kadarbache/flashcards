/**
 * The word finder, against a stand-in for Gemini.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  DEFAULT_CHAT_MODEL,
  MAX_MESSAGE,
  buildRequest,
  cardList,
  cleanConversation,
  findWords,
  parseAnswer,
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

function answer(content: unknown) {
  return Response.json({
    candidates: [
      { content: { parts: [{ text: typeof content === "string" ? content : JSON.stringify(content) }] } },
    ],
  });
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
    const parsed = parseAnswer(
      { candidates: [{ content: { parts: [{ text: '{"reply":"That is precise.","cards":[2,2,9,0,1.5,"3"]}' }] } }] },
      CARDS,
    );
    assert.deepEqual(parsed, {
      reply: "That is precise.",
      matches: [
        { id: "c2", deckId: "d1", deckName: "Obsidian", front: "precise", back: "Exact and accurate." },
        { id: "c3", deckId: "d2", deckName: "Videos", front: "devout", back: "Very religious." },
      ],
    });
  });

  it("reads JSON in a code fence", () => {
    const parsed = parseAnswer(
      { candidates: [{ content: { parts: [{ text: '```json\n{"reply":"Not in your cards.","cards":[]}\n```' }] } }] },
      CARDS,
    );
    assert.deepEqual(parsed, { reply: "Not in your cards.", matches: [] });
  });

  it("gives up on an answer it cannot use", () => {
    const body = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
    assert.equal(parseAnswer({}, CARDS), null);
    assert.equal(parseAnswer(body("not json"), CARDS), null);
    assert.equal(parseAnswer(body('{"reply":"  ","cards":[1]}'), CARDS), null);
  });
});

describe("findWords", () => {
  it("asks Gemini with the key and answers with the matching cards", async () => {
    const gemini = fakeGemini(() => answer({ reply: "You mean precise.", cards: [2] }));
    const outcome = await findWords(ASK, CARDS, { apiKey: "g-test", fetchImpl: gemini.fetchImpl });

    assert.deepEqual(outcome, {
      ok: true,
      reply: "You mean precise.",
      matches: [{ id: "c2", deckId: "d1", deckName: "Obsidian", front: "precise", back: "Exact and accurate." }],
    });
    const [call] = gemini.calls;
    assert.equal(
      call.url,
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_CHAT_MODEL}:generateContent`,
    );
    assert.equal((call.init?.headers as Record<string, string>)["x-goog-api-key"], "g-test");
  });

  it("uses the model it is given", async () => {
    const gemini = fakeGemini(() => answer({ reply: "Precise.", cards: [] }));
    await findWords(ASK, CARDS, { apiKey: "k", model: " gemini-3.8-flash ", fetchImpl: gemini.fetchImpl });
    assert.match(gemini.calls[0].url, /\/gemini-3\.8-flash:generateContent$/);
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
