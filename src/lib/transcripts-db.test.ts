/**
 * Getting and saving transcripts, against stand-ins for YouTube and Supadata
 * and an in-process MongoDB: the saved copy, the fallback order, and uploads.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/connect";
import { Card, Deck, Transcript } from "@/lib/db/models";
import {
  getTranscript,
  listRecentVideos,
  listSavedCards,
  saveUploadedTranscript,
} from "@/lib/transcripts-db";
import { fetchFromSupadata, fetchFromYouTube } from "@/lib/transcript-sources";

const VIDEO = "dQw4w9WgXcQ";

const CAPTION_XML =
  '<transcript><text start="1" dur="2">Hello there.</text><text start="3" dur="2">How are you?</text></transcript>';

type Behaviour = "ok" | "blocked" | "no-captions" | "empty-file";

/**
 * A pretend internet. Records every URL asked for, so a test can see which
 * sources were tried.
 */
function fakeNet(youtube: Behaviour, supadata: "ok" | "none" | "unavailable" = "none") {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    if (url.includes("/youtubei/v1/player")) {
      if (youtube === "blocked") {
        return Response.json({
          playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" },
        });
      }
      if (youtube === "no-captions") {
        return Response.json({ playabilityStatus: { status: "OK" }, videoDetails: { title: "Silent film" } });
      }
      return Response.json({
        playabilityStatus: { status: "OK" },
        videoDetails: { title: "Rick" },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=srv3",
                languageCode: "en",
                kind: "asr",
                name: { runs: [{ text: "English (auto-generated)" }] },
              },
              {
                baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=de",
                languageCode: "de",
                name: { simpleText: "German" },
              },
            ],
          },
        },
      });
    }
    if (url.includes("/api/timedtext")) {
      assert.ok(!url.includes("fmt="), "the caption file is asked for as plain XML");
      return new Response(youtube === "empty-file" ? "" : CAPTION_XML);
    }
    if (url.startsWith("https://api.supadata.ai/")) {
      if (supadata === "unavailable")
        return Response.json({ error: "transcript-unavailable" }, { status: 206 });
      return Response.json({
        lang: "en",
        content: [
          { text: "From the backup.", offset: 1500, duration: 1000, lang: "en" },
          { text: "It works.", offset: 3000, duration: 1000, lang: "en" },
        ],
      });
    }
    if (url.includes("/oembed")) return Response.json({ title: "Title from oEmbed" });
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

describe("fetchFromYouTube", () => {
  it("picks a track and reads its captions", async () => {
    const { fetchImpl } = fakeNet("ok");
    const result = await fetchFromYouTube(VIDEO, fetchImpl);
    assert.ok(result.ok);
    assert.equal(result.title, "Rick");
    assert.deepEqual(result.track, { lang: "en", name: "English (auto-generated)", auto: true });
    assert.equal(result.segments.length, 2);
  });

  it("names the refusal YouTube gives cloud servers", async () => {
    assert.deepEqual(await fetchFromYouTube(VIDEO, fakeNet("blocked").fetchImpl), {
      ok: false,
      reason: "blocked",
    });
    assert.deepEqual(await fetchFromYouTube(VIDEO, fakeNet("empty-file").fetchImpl), {
      ok: false,
      reason: "blocked",
    });
  });

  it("tells a video with no captions apart", async () => {
    assert.deepEqual(await fetchFromYouTube(VIDEO, fakeNet("no-captions").fetchImpl), {
      ok: false,
      reason: "no-captions",
    });
  });
});

describe("fetchFromSupadata", () => {
  it("turns milliseconds into seconds", async () => {
    const result = await fetchFromSupadata(VIDEO, "key", fakeNet("ok", "ok").fetchImpl);
    assert.ok(result.ok);
    assert.deepEqual(result.segments[0], { start: 1.5, duration: 1, text: "From the backup." });
  });

  it("waits for a job when the video is long", async () => {
    let polls = 0;
    const fetchImpl = async (url: string) => {
      if (url.includes("/transcript/job-1")) {
        polls += 1;
        return polls < 2
          ? Response.json({ status: "active" })
          : Response.json({
              status: "completed",
              lang: "en",
              content: [{ text: "Done.", offset: 0, duration: 500 }],
            });
      }
      return Response.json({ jobId: "job-1" }, { status: 202 });
    };
    const result = await fetchFromSupadata(VIDEO, "key", fetchImpl, async () => {});
    assert.ok(result.ok);
    assert.equal(result.segments[0].text, "Done.");
    assert.equal(polls, 2);
  });
});

describe("transcripts in the database", () => {
  let mongo: MongoMemoryServer;

  before(
    async () => {
      mongo = await MongoMemoryServer.create();
      process.env.MONGODB_URI = mongo.getUri();
      process.env.MONGODB_DB = "flashcards_transcript_test";
      await connectToDatabase();
      await Transcript.init();
    },
    { timeout: 300_000 },
  );

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([Transcript.deleteMany({}), Card.deleteMany({}), Deck.deleteMany({})]);
  });

  it("fetches once, then serves the saved copy", async () => {
    const net = fakeNet("ok");
    const first = await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: null });
    assert.ok(first.ok);
    assert.equal(first.transcript.source, "youtube");
    assert.equal(first.transcript.title, "Rick");
    assert.deepEqual(
      first.transcript.lines.map((line) => line.text),
      ["Hello there.", "How are you?"],
    );

    const callsAfterFirst = net.calls.length;
    const second = await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: null });
    assert.ok(second.ok);
    assert.equal(net.calls.length, callsAfterFirst, "the second visit asks nobody");
    assert.deepEqual(second.transcript.lines, first.transcript.lines);
  });

  it("uses the backup when YouTube refuses, if a key is set", async () => {
    const net = fakeNet("blocked", "ok");
    const outcome = await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: "key" });
    assert.ok(outcome.ok);
    assert.equal(outcome.transcript.source, "supadata");
    assert.equal(outcome.transcript.title, "Title from oEmbed");
    assert.deepEqual(
      outcome.transcript.lines.map((line) => line.text),
      ["From the backup.", "It works."],
    );
  });

  it("reports the refusal when there is no backup, and saves nothing", async () => {
    const net = fakeNet("blocked", "ok");
    const outcome = await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: null });
    assert.deepEqual(outcome, { ok: false, reason: "blocked", title: "Title from oEmbed" });
    assert.ok(!net.calls.some((url) => url.includes("supadata")));
    assert.equal(await Transcript.countDocuments(), 0);
  });

  it("does not spend a backup request on a video with no captions", async () => {
    const net = fakeNet("no-captions", "ok");
    const outcome = await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: "key" });
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.reason, "no-captions");
    assert.ok(!net.calls.some((url) => url.includes("supadata")));
  });

  it("saves one copy of YouTube's captions, in English when the video has it", async () => {
    const net = fakeNet("ok");
    const outcome = await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: null });
    assert.ok(outcome.ok);
    assert.equal(outcome.transcript.lang, "en");
    assert.ok(!net.calls.some((url) => url.includes("lang=de")), "the German track is never fetched");
    assert.equal(await Transcript.countDocuments({ videoId: VIDEO }), 1);
  });

  it("shows an uploaded transcript in place of YouTube's from then on", async () => {
    const net = fakeNet("ok");
    await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: null });

    const uploaded = await saveUploadedTranscript(
      VIDEO,
      "1\n00:00:02,000 --> 00:00:04,000\nMy own words.\n",
      { fetchImpl: net.fetchImpl },
    );
    assert.ok(uploaded.ok);
    assert.equal(uploaded.transcript.title, "Rick", "the title comes from the saved copy");

    const shown = await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: null });
    assert.ok(shown.ok);
    assert.equal(shown.transcript.source, "upload");
    assert.deepEqual(shown.transcript.lines, [{ start: 2, text: "My own words." }]);
  });

  it("refuses an upload with no text in it", async () => {
    assert.deepEqual(await saveUploadedTranscript(VIDEO, "   "), {
      ok: false,
      message: "There was no text in that.",
    });
  });

  it("lists recent videos once each, newest first", async () => {
    const net = fakeNet("ok");
    await getTranscript(VIDEO, { fetchImpl: net.fetchImpl, supadataKey: null });
    await getTranscript("jNQXAC9IVRw", { fetchImpl: net.fetchImpl, supadataKey: null });

    const recent = await listRecentVideos();
    assert.deepEqual(
      recent.map((video) => video.videoId),
      ["jNQXAC9IVRw", VIDEO],
    );
  });

  it("lists every saved card with its deck, for the watch screen to check words against", async () => {
    const [vocab, other] = await Deck.create([{ name: "Vocab" }, { name: "Other" }]);
    const [stranger, rule] = await Card.create([
      { deckId: vocab._id, front: "Stranger", back: "someone you do not know", example: "not sent" },
      { deckId: other._id, front: "rule", back: "what you must do" },
    ]);

    const cards = await listSavedCards();
    assert.deepEqual(
      cards.sort((a, b) => a.front.localeCompare(b.front)),
      [
        { id: String(rule._id), deckId: String(other._id), front: "rule", back: "what you must do" },
        {
          id: String(stranger._id),
          deckId: String(vocab._id),
          front: "Stranger",
          back: "someone you do not know",
        },
      ],
    );
  });
});
