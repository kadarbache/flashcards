/**
 * Transcript handling: links, caption files, sentence lines and clickable words.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeLineIndex,
  decodeEntities,
  findSavedCards,
  formatTimestamp,
  linesFromSegments,
  parseStartTime,
  parseSubtitleFile,
  parseTimedTextXml,
  parseVideoId,
  pickTrack,
  tokenize,
} from "@/lib/transcript";

describe("parseVideoId", () => {
  const id = "dQw4w9WgXcQ";

  it("reads every common link shape", () => {
    for (const link of [
      id,
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?feature=share&v=${id}&t=42s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}?feature=share`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `  ${id}  `,
    ]) {
      assert.equal(parseVideoId(link), id, link);
    }
  });

  it("rejects things that are not a video", () => {
    for (const link of [
      "",
      "hello",
      "https://www.youtube.com/",
      "https://www.youtube.com/watch?v=short",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/@channel",
    ]) {
      assert.equal(parseVideoId(link), null, link);
    }
  });
});

describe("parseStartTime and formatTimestamp", () => {
  it("reads the time formats YouTube links use", () => {
    assert.equal(parseStartTime("90"), 90);
    assert.equal(parseStartTime("90s"), 90);
    assert.equal(parseStartTime("1m30s"), 90);
    assert.equal(parseStartTime("1h2m3s"), 3723);
    assert.equal(parseStartTime(""), 0);
    assert.equal(parseStartTime(null), 0);
    assert.equal(parseStartTime("soon"), 0);
  });

  it("prints minutes, and hours only when needed", () => {
    assert.equal(formatTimestamp(7.9), "0:07");
    assert.equal(formatTimestamp(750), "12:30");
    assert.equal(formatTimestamp(3723), "1:02:03");
  });
});

describe("decodeEntities", () => {
  it("undoes YouTube's double encoding", () => {
    assert.equal(decodeEntities("We&amp;#39;re here &amp;amp; there"), "We're here & there");
    assert.equal(decodeEntities("&lt;b&gt; &quot;hi&quot; &#x2019; &#8217;"), '<b> "hi" ’ ’');
  });

  it("leaves unknown entities alone", () => {
    assert.equal(decodeEntities("&bogus; &#0;"), "&bogus; &#0;");
  });
});

/** The shape YouTube's caption file really has, auto captions included. */
const AUTO_XML = `<?xml version="1.0" encoding="utf-8" ?><transcript><text start="0.32" dur="14.26">[Music]</text><text start="18.8" dur="7.16">We&amp;#39;re no strangers to</text><text start="21.8" dur="7.319">love. You know the rules and so do</text><text start="25.96" dur="4.319">I. I feel commitments from what I&amp;#39;m</text><text start="29.119" dur="5.241">thinking</text><text start="30.279" dur="9.28">of.</text></transcript>`;

describe("parseTimedTextXml", () => {
  it("reads start, duration and text", () => {
    const segments = parseTimedTextXml(AUTO_XML);
    assert.equal(segments.length, 6);
    assert.deepEqual(segments[1], { start: 18.8, duration: 7.16, text: "We&amp;#39;re no strangers to" });
  });

  it("copes with multi-line text and a missing duration", () => {
    const segments = parseTimedTextXml('<text start="1.2">All right,\nhere we are</text>');
    assert.deepEqual(segments, [{ start: 1.2, duration: 0, text: "All right,\nhere we are" }]);
  });
});

describe("linesFromSegments", () => {
  it("re-cuts punctuated fragments at sentence ends", () => {
    const lines = linesFromSegments(parseTimedTextXml(AUTO_XML));
    assert.deepEqual(
      lines.map((line) => line.text),
      [
        "[Music]",
        "We're no strangers to love.",
        "You know the rules and so do I.",
        "I feel commitments from what I'm thinking of.",
      ],
    );
    // Each line starts when its first word is spoken.
    assert.equal(lines[1].start, 18.8);
    assert.ok(lines[2].start > 21.8 && lines[2].start < 25.96);
  });

  it("keeps fragments as lines when the captions have no punctuation", () => {
    const lines = linesFromSegments([
      { start: 1, duration: 2, text: "so here we are in front of the" },
      { start: 3, duration: 2, text: "elephants the cool thing about these guys" },
      { start: 5, duration: 2, text: "is that they have really long trunks" },
    ]);
    assert.deepEqual(
      lines.map((line) => [line.start, line.text]),
      [
        [1, "so here we are in front of the"],
        [3, "elephants the cool thing about these guys"],
        [5, "is that they have really long trunks"],
      ],
    );
  });

  it("starts a new line after a long pause, mid-sentence or not", () => {
    const lines = linesFromSegments([
      { start: 0, duration: 1, text: "Well, I think that" },
      { start: 9, duration: 1, text: "it works. Yes it does." },
    ]);
    assert.deepEqual(
      lines.map((line) => line.text),
      ["Well, I think that", "it works.", "Yes it does."],
    );
  });

  it("drops empty fragments and sorts by time", () => {
    const lines = linesFromSegments([
      { start: 5, duration: 1, text: "Second one here." },
      { start: 2, duration: 1, text: "   " },
      { start: 1, duration: 1, text: "First one here." },
    ]);
    assert.deepEqual(
      lines.map((line) => line.text),
      ["First one here.", "Second one here."],
    );
  });
});

describe("parseSubtitleFile", () => {
  it("reads SRT", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
Hello there, my friend.

2
00:00:04,000 --> 00:00:06,000
<i>How are you today?</i>
`;
    const { lines, timed } = parseSubtitleFile(srt);
    assert.equal(timed, true);
    assert.deepEqual(lines, [
      { start: 1, text: "Hello there, my friend." },
      { start: 4, text: "How are you today?" },
    ]);
  });

  it("reads WebVTT, and skips the rolled-up repeats of YouTube's auto captions", () => {
    const vtt = `WEBVTT
Kind: captions

00:00:01.000 --> 00:00:02.000 align:start position:0%
we're no strangers

00:00:02.000 --> 00:00:03.000 align:start position:0%
we're no strangers
to<00:00:02.500><c> love</c>

01:00:00.000 --> 01:00:01.000
the end
`;
    const { lines, timed } = parseSubtitleFile(vtt);
    assert.equal(timed, true);
    assert.deepEqual(
      lines.map((line) => [line.start, line.text]),
      [
        [1, "we're no strangers"],
        [2, "to love"],
        [3600, "the end"],
      ],
    );
  });

  it("splits plain text into sentences with no times", () => {
    const { lines, timed } = parseSubtitleFile(
      "﻿First sentence is here.\r\nSecond one is here too! And a third one?",
    );
    assert.equal(timed, false);
    assert.deepEqual(
      lines.map((line) => line.text),
      ["First sentence is here.", "Second one is here too!", "And a third one?"],
    );
  });

  it("returns nothing for an empty file", () => {
    assert.deepEqual(parseSubtitleFile("  \n ").lines, []);
  });
});

describe("tokenize", () => {
  it("keeps every character and marks the words", () => {
    const tokens = tokenize("We’re no strangers—to LOVE, 2 times.");
    assert.equal(tokens.map((token) => token.text).join(""), "We’re no strangers—to LOVE, 2 times.");
    assert.deepEqual(
      tokens.filter((token) => token.word).map((token) => token.word),
      ["we're", "no", "strangers", "to", "love", "times"],
    );
  });

  it("handles letters beyond English", () => {
    assert.deepEqual(
      tokenize("café naïve").map((token) => token.word),
      ["café", null, "naïve"],
    );
  });
});

describe("findSavedCards", () => {
  const cards = [
    { id: "1", deckId: "a", front: "Stranger", back: "someone you do not know" },
    { id: "2", deckId: "b", front: "stranger", back: "a person not known" },
    { id: "3", deckId: "a", front: "run", back: "move fast" },
    { id: "4", deckId: "a", front: "give up", back: "stop trying" },
  ];

  it("finds a word in every deck that has it, whatever its case or punctuation", () => {
    assert.deepEqual(
      findSavedCards(cards, ["stranger,"]).map((card) => card.id),
      ["1", "2"],
    );
  });

  it("checks the dictionary form too, and phrases whole", () => {
    assert.deepEqual(
      findSavedCards(cards, ["running", "run"]).map((card) => card.id),
      ["3"],
    );
    assert.deepEqual(
      findSavedCards(cards, ["Give up"]).map((card) => card.id),
      ["4"],
    );
  });

  it("finds nothing for a word no card has, or for no word", () => {
    assert.deepEqual(findSavedCards(cards, ["love"]), []);
    assert.deepEqual(findSavedCards(cards, ["", "..."]), []);
  });
});

describe("activeLineIndex", () => {
  const lines = [0, 5, 10].map((start) => ({ start, text: "x" }));

  it("finds the last line that has started", () => {
    assert.equal(activeLineIndex(lines, 0), 0);
    assert.equal(activeLineIndex(lines, 7.5), 1);
    assert.equal(activeLineIndex(lines, 10), 2);
    assert.equal(activeLineIndex(lines, 999), 2);
  });

  it("is -1 before the first line and for no lines", () => {
    assert.equal(activeLineIndex([{ start: 3, text: "x" }], 1), -1);
    assert.equal(activeLineIndex([], 1), -1);
  });
});

describe("pickTrack", () => {
  const tracks = [
    { lang: "de", name: "German", auto: false },
    { lang: "en", name: "English (auto-generated)", auto: true },
    { lang: "en-GB", name: "English (UK)", auto: false },
    { lang: "fr", name: "French", auto: true },
  ];

  it("prefers English written by a person", () => {
    assert.equal(pickTrack(tracks)?.lang, "en-GB");
    assert.equal(pickTrack(tracks.slice(0, 2))?.lang, "en", "auto-made English beats other languages");
  });

  it("falls back to a written track, then to anything", () => {
    assert.equal(pickTrack([tracks[3], tracks[0]])?.lang, "de");
    assert.equal(pickTrack([tracks[3]])?.lang, "fr");
    assert.equal(pickTrack([]), null);
  });
});
