/**
 * AI meanings, against a stand-in for OpenRouter and the dictionary.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { DEFAULT_MODEL, defineInContext, explainWord, parseAnswer } from "@/lib/ai-meaning";
import { resetDictionaryHealth } from "@/lib/dictionary";

const SENTENCE = "We're no strangers to love.";

type Call = { url: string; init?: RequestInit };

function answer(content: unknown) {
  return Response.json({
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  });
}

/** OpenRouter answers with `replies` in turn; the dictionary knows "stranger". */
function fakeNet(...replies: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("https://openrouter.ai/")) {
      const reply = replies.shift();
      if (!reply) throw new Error("unexpected OpenRouter call");
      return reply();
    }
    if (url.startsWith("https://api.dictionaryapi.dev/")) {
      return url.endsWith("/stranger")
        ? Response.json([
            {
              word: "stranger",
              phonetics: [],
              meanings: [
                { partOfSpeech: "noun", definitions: [{ definition: "A person you do not know." }] },
              ],
            },
          ])
        : Response.json({ title: "No Definitions Found" }, { status: 404 });
    }
    return new Response("", { status: 404 });
  };
  const bodies = () =>
    calls
      .filter((call) => call.url.startsWith("https://openrouter.ai/"))
      .map((call) => JSON.parse(String(call.init?.body)));
  return { fetchImpl, calls, bodies };
}

const good = () => answer({ word: "stranger", partOfSpeech: "noun", meaning: "someone you do not know." });

beforeEach(() => {
  resetDictionaryHealth();
  mock.method(console, "warn", () => {});
});
afterEach(() => mock.restoreAll());

describe("explainWord", () => {
  it("asks for one meaning in context, without thinking, from the quickest provider", async () => {
    const net = fakeNet(good);
    const entry = await explainWord("strangers", SENTENCE, { apiKey: "sk-test", fetchImpl: net.fetchImpl });

    assert.deepEqual(entry, {
      word: "stranger",
      phonetic: null,
      audio: null,
      meanings: [
        { partOfSpeech: "noun", definitions: [{ definition: "someone you do not know", example: null }] },
      ],
      inContext: true,
    });

    const [call] = net.calls;
    assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal((call.init?.headers as Record<string, string>).authorization, "Bearer sk-test");
    const [body] = net.bodies();
    assert.equal(body.model, DEFAULT_MODEL);
    assert.match(body.messages[1].content, /<word>strangers<\/word>/);
    assert.match(body.messages[1].content, /We're no strangers to love\./);
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.reasoning, { effort: "none" });
    // Some models' providers refuse it, and with require_parameters none would be left.
    assert.equal(body.temperature, undefined);
    assert.deepEqual(body.provider, { sort: "latency", require_parameters: true });
  });

  it("uses the model it is given", async () => {
    const net = fakeNet(good);
    await explainWord("strangers", SENTENCE, {
      apiKey: "k",
      model: "z-ai/glm-5.3-flash",
      fetchImpl: net.fetchImpl,
    });
    assert.equal(net.bodies()[0].model, "z-ai/glm-5.3-flash");
  });

  it("asks again without turning thinking off when the model refuses that", async () => {
    const net = fakeNet(
      () => Response.json({ error: { message: "effort none unsupported" } }, { status: 400 }),
      good,
    );
    const entry = await explainWord("strangers", SENTENCE, { apiKey: "k", fetchImpl: net.fetchImpl });
    assert.equal(entry?.word, "stranger");
    const [first, second] = net.bodies();
    assert.deepEqual(first.reasoning, { effort: "none" });
    assert.equal(second.reasoning, undefined);
  });

  it("gives up on a wrong key, and says so in the logs", async () => {
    const net = fakeNet(() => Response.json({ error: { message: "No auth" } }, { status: 401 }));
    assert.equal(await explainWord("strangers", SENTENCE, { apiKey: "bad", fetchImpl: net.fetchImpl }), null);
    const warn = console.warn as unknown as { mock: { callCount(): number } };
    assert.equal(warn.mock.callCount(), 1);
  });

  it("gives up on a timeout or a network error", async () => {
    const net = fakeNet(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    assert.equal(await explainWord("strangers", SENTENCE, { apiKey: "k", fetchImpl: net.fetchImpl }), null);
  });
});

describe("parseAnswer", () => {
  it("reads JSON even inside a code fence", () => {
    const entry = parseAnswer({
      choices: [
        {
          message: {
            content: '```json\n{"word":"give up","partOfSpeech":"phrasal verb","meaning":"stop trying"}\n```',
          },
        },
      ],
    });
    assert.equal(entry?.word, "give up");
    assert.equal(entry?.meanings[0].partOfSpeech, "phrasal verb");
  });

  it("refuses answers it cannot use", () => {
    const content = (value: unknown) => ({ choices: [{ message: { content: value } }] });
    assert.equal(parseAnswer(content("not json")), null);
    assert.equal(parseAnswer(content('{"word":"x","partOfSpeech":"noun","meaning":""}')), null);
    assert.equal(
      parseAnswer(content(`{"word":"x","partOfSpeech":"noun","meaning":"${"long ".repeat(80)}"}`)),
      null,
    );
    assert.equal(parseAnswer({ choices: [] }), null);
    assert.equal(parseAnswer(null), null);
  });
});

describe("defineInContext", () => {
  it("uses the AI when there is a key", async () => {
    const net = fakeNet(good);
    const outcome = await defineInContext("strangers", SENTENCE, { apiKey: "k", fetchImpl: net.fetchImpl });
    assert.ok(outcome.ok);
    assert.equal(outcome.entry.inContext, true);
    assert.ok(!net.calls.some((call) => call.url.includes("dictionaryapi")), "the dictionary is not asked");
  });

  it("falls back to the dictionary when the AI fails", async () => {
    const net = fakeNet(() => new Response("", { status: 502 }));
    const outcome = await defineInContext("strangers", SENTENCE, { apiKey: "k", fetchImpl: net.fetchImpl });
    assert.ok(outcome.ok);
    assert.equal(outcome.entry.word, "stranger");
    assert.equal(outcome.entry.inContext, undefined);
  });

  it("goes straight to the dictionary without a key", async () => {
    const net = fakeNet();
    const outcome = await defineInContext("strangers", SENTENCE, { apiKey: null, fetchImpl: net.fetchImpl });
    assert.ok(outcome.ok);
    assert.ok(!net.calls.some((call) => call.url.startsWith("https://openrouter.ai/")));
  });
});
