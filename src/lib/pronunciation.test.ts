/**
 * The AI voice: the WAV it hands back, the request Gemini is sent, and that
 * each word is made once and then served saved.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Pronunciation } from "@/lib/db/models";
import {
  DEFAULT_VOICE,
  DEFAULT_VOICE_MODEL,
  SPARE_VOICE_MODEL,
  audioFrom,
  pronunciationOf,
  synthesize,
  trimSilence,
  wavFile,
} from "@/lib/pronunciation";

const RATE = 24000;

/** `seconds` of 16-bit samples, silent or a loud square wave. */
function samples(seconds: number, loud: boolean): Buffer {
  const count = Math.round(RATE * seconds);
  const buffer = Buffer.alloc(count * 2);
  if (loud) for (let i = 0; i < count; i += 1) buffer.writeInt16LE(i % 40 < 20 ? 8000 : -8000, i * 2);
  return buffer;
}

/** Half a second of silence, a 0.4 s "word", then a second of silence, as the voice pads it. */
function paddedWord(): Buffer {
  return wavFile({
    sampleRate: RATE,
    samples: Buffer.concat([samples(0.5, false), samples(0.4, true), samples(1, false)]),
  });
}

const seconds = (wav: Buffer) => (wav.length - 44) / 2 / wav.readUInt32LE(24);

/** Gemini's answer holding `wav`. */
function answer(wav: Buffer, mimeType = "audio/wav") {
  return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: wav.toString("base64") } }] } }] });
}

describe("trimSilence", () => {
  it("cuts the padding around the word, keeping a little either side", () => {
    const trimmed = trimSilence(paddedWord());
    assert.equal(trimmed.toString("ascii", 0, 4), "RIFF");
    assert.equal(trimmed.readUInt32LE(24), RATE);
    assert.ok(Math.abs(seconds(trimmed) - 0.52) < 0.01, `expected about 0.52 s, got ${seconds(trimmed)}`);
  });

  it("leaves alone what it cannot read, and a file that is all silence", () => {
    const notWav = Buffer.from("not a wav file at all");
    assert.equal(trimSilence(notWav), notWav);
    const silent = wavFile({ sampleRate: RATE, samples: samples(1, false) });
    assert.equal(trimSilence(silent), silent);
  });
});

describe("audioFrom", () => {
  it("takes the WAV out of Gemini's answer, trimmed", async () => {
    const wav = audioFrom(await answer(paddedWord()).json());
    assert.ok(wav && seconds(wav) < 0.6);
  });

  it("wraps raw PCM in a WAV at the rate the mime type gives", async () => {
    const pcm = samples(0.3, true);
    const wav = audioFrom(
      await answer(pcm, "audio/L16;codec=pcm;rate=16000").json(),
    );
    assert.equal(wav?.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav?.readUInt32LE(24), 16000);
  });

  it("finds nothing in an answer without audio", () => {
    assert.equal(audioFrom({ candidates: [{ content: { parts: [{ text: "hello" }] } }] }), null);
    assert.equal(audioFrom({}), null);
    assert.equal(audioFrom(null), null);
  });
});

describe("synthesize", () => {
  beforeEach(() => mock.method(console, "warn", () => {}));
  afterEach(() => mock.restoreAll());

  it("asks the quick model for audio in the chosen voice", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const wav = await synthesize("essence", {
      apiKey: "test-key",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return answer(paddedWord());
      },
    });
    assert.ok(wav);

    const [call] = calls;
    assert.equal(call.url, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_VOICE_MODEL}:generateContent`);
    assert.equal((call.init?.headers as Record<string, string>)["x-goog-api-key"], "test-key");
    const body = JSON.parse(String(call.init?.body));
    assert.deepEqual(body.contents, [{ parts: [{ text: "essence" }] }]);
    assert.deepEqual(body.generationConfig.responseModalities, ["AUDIO"]);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, DEFAULT_VOICE);
  });

  it("uses the model and voice it is given", async () => {
    let url = "";
    let voice = "";
    await synthesize("essence", {
      apiKey: "k",
      model: "gemini-3.8-flash-tts",
      voice: "Puck",
      fetchImpl: async (to, init) => {
        url = to;
        voice = JSON.parse(String(init?.body)).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName;
        return answer(paddedWord());
      },
    });
    assert.match(url, /\/gemini-3\.8-flash-tts:generateContent$/);
    assert.equal(voice, "Puck");
  });

  it("asks the spare model when the first one's allowance is used up for the minute", async () => {
    const urls: string[] = [];
    const wav = await synthesize("essence", {
      apiKey: "k",
      fetchImpl: async (url) => {
        urls.push(url);
        return urls.length === 1
          ? Response.json({ error: { message: "quota" } }, { status: 429 })
          : answer(paddedWord());
      },
    });
    assert.ok(wav);
    assert.match(urls[0], new RegExp(`/${DEFAULT_VOICE_MODEL}:`));
    assert.match(urls[1], new RegExp(`/${SPARE_VOICE_MODEL}:`));
  });

  it("gives up when both are used up, and says so in the logs", async () => {
    let asked = 0;
    const wav = await synthesize("essence", {
      apiKey: "k",
      fetchImpl: async () => {
        asked += 1;
        return Response.json({ error: { message: "quota" } }, { status: 429 });
      },
    });
    assert.equal(wav, null);
    assert.equal(asked, 2);
    assert.equal((console.warn as unknown as { mock: { callCount(): number } }).mock.callCount(), 1);
  });

  it("does not try the spare model for other failures", async () => {
    let asked = 0;
    const wav = await synthesize("essence", {
      apiKey: "bad",
      fetchImpl: async () => {
        asked += 1;
        return Response.json({ error: { message: "bad key" } }, { status: 403 });
      },
    });
    assert.equal(wav, null);
    assert.equal(asked, 1);
  });

  it("gives up on a timeout or a network error", async () => {
    const wav = await synthesize("essence", {
      apiKey: "k",
      fetchImpl: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    });
    assert.equal(wav, null);
  });
});

describe("pronunciationOf", () => {
  let mongo: MongoMemoryServer;

  before(
    async () => {
      mongo = await MongoMemoryServer.create();
      process.env.MONGODB_URI = mongo.getUri();
      process.env.MONGODB_DB = "flashcards_pronunciation_test";
      await connectToDatabase();
      await Pronunciation.init();
    },
    { timeout: 300_000 },
  );

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Pronunciation.deleteMany({});
    mock.method(console, "warn", () => {});
  });
  afterEach(() => mock.restoreAll());

  it("makes a word once, then serves the saved clip", async () => {
    let asked = 0;
    const fetchImpl = async () => {
      asked += 1;
      return answer(paddedWord());
    };

    const first = await pronunciationOf("essence", { apiKey: "k", fetchImpl });
    const second = await pronunciationOf("essence", { apiKey: "k", fetchImpl });

    assert.equal(asked, 1, "Gemini is asked only the first time");
    assert.ok(first && second);
    assert.deepEqual(second, first);
    assert.equal(await Pronunciation.countDocuments({ text: "essence", voice: DEFAULT_VOICE }), 1);
  });

  it("keeps each voice's clip apart", async () => {
    const fetchImpl = async () => answer(paddedWord());
    await pronunciationOf("essence", { apiKey: "k", fetchImpl });
    await pronunciationOf("essence", { apiKey: "k", voice: "Puck", fetchImpl });
    assert.equal(await Pronunciation.countDocuments({ text: "essence" }), 2);
  });

  it("saves nothing when the voice fails, so the next tap tries again", async () => {
    const audio = await pronunciationOf("essence", {
      apiKey: "k",
      fetchImpl: async () => new Response("", { status: 503 }),
    });
    assert.equal(audio, null);
    assert.equal(await Pronunciation.countDocuments({}), 0);
  });
});
