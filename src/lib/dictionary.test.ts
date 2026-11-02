/**
 * Word lookups, against a stand-in for the dictionary API.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { fromWiktionary, lookupWord, resetDictionaryHealth, toEntry, wordCandidates } from "@/lib/dictionary";

// Each test starts with the Free Dictionary presumed healthy.
beforeEach(() => resetDictionaryHealth());

describe("wordCandidates", () => {
  it("tries the word first, then likely base forms", () => {
    assert.deepEqual(wordCandidates("Cities").slice(0, 2), ["cities", "city"]);
    assert.equal(wordCandidates("stopped")[1], "stop");
    assert.equal(wordCandidates("running")[1], "run");
    assert.ok(wordCandidates("making").includes("make"));
    assert.equal(wordCandidates("boxes")[1], "box");
    assert.equal(wordCandidates("makes")[1], "make");
    assert.equal(wordCandidates("quickly")[1], "quick");
  });

  it("drops possessives and curly apostrophes", () => {
    assert.equal(wordCandidates("John’s")[0], "john");
    assert.equal(wordCandidates("teachers'")[0], "teachers");
  });

  it("does not undouble letters that come in pairs", () => {
    assert.ok(wordCandidates("falling").includes("fall"));
    assert.ok(!wordCandidates("falling").includes("fal"));
  });

  it("gives nothing for no word", () => {
    assert.deepEqual(wordCandidates("  —  "), []);
  });
});

describe("toEntry", () => {
  it("groups meanings by part of speech across entries, without repeats", () => {
    const entry = toEntry("run", [
      {
        word: "run",
        phonetics: [{ text: "/ɹʌn/", audio: "" }, { audio: "https://example.com/run.mp3" }],
        meanings: [
          { partOfSpeech: "verb", definitions: [{ definition: "To move swiftly.", example: "Run!" }] },
          { partOfSpeech: "noun", definitions: [{ definition: "An act of running." }] },
        ],
      },
      {
        word: "run",
        meanings: [
          {
            partOfSpeech: "verb",
            definitions: [{ definition: "To move swiftly." }, { definition: "To operate." }],
          },
        ],
      },
    ]);
    assert.deepEqual(entry, {
      word: "run",
      phonetic: "/ɹʌn/",
      audio: "https://example.com/run.mp3",
      meanings: [
        {
          partOfSpeech: "verb",
          definitions: [
            { definition: "To move swiftly.", example: "Run!" },
            { definition: "To operate.", example: null },
          ],
        },
        { partOfSpeech: "noun", definitions: [{ definition: "An act of running.", example: null }] },
      ],
    });
  });

  it("is null when there is nothing to show", () => {
    assert.equal(toEntry("x", [{ meanings: [] }]), null);
  });
});

/** A dictionary that knows only the words given, the way the real API answers. */
function fakeDictionary(known: Record<string, string>, calls: string[] = []) {
  return async (url: string) => {
    const word = decodeURIComponent(url.split("/").pop() ?? "");
    calls.push(word);
    if (!(word in known)) {
      return new Response(JSON.stringify({ title: "No Definitions Found" }), { status: 404 });
    }
    return Response.json([
      { word, meanings: [{ partOfSpeech: "noun", definitions: [{ definition: known[word] }] }] },
    ]);
  };
}

describe("lookupWord", () => {
  it("finds the word as clicked", async () => {
    const outcome = await lookupWord("Stranger", fakeDictionary({ stranger: "Someone you do not know." }));
    assert.ok(outcome.ok);
    assert.equal(outcome.entry.word, "stranger");
  });

  it("falls back to a base form, and stops at the first hit", async () => {
    const calls: string[] = [];
    const outcome = await lookupWord("cities", fakeDictionary({ city: "A large town." }, calls));
    assert.ok(outcome.ok);
    assert.equal(outcome.entry.word, "city");
    assert.deepEqual(calls, ["cities", "city"]);
  });

  it("says not found when no form is in the dictionary", async () => {
    assert.deepEqual(await lookupWord("blorp", fakeDictionary({})), { ok: false, reason: "not-found" });
  });

  it("says failed when the dictionary cannot be reached", async () => {
    const outcome = await lookupWord("word", async () => {
      throw new Error("offline");
    });
    assert.deepEqual(outcome, { ok: false, reason: "failed" });
  });
});

/** Wiktionary's answer for a word, in its HTML-laden shape. */
function wiktionaryEntry(partOfSpeech: string, html: string, example?: string) {
  return {
    en: [
      {
        partOfSpeech,
        language: "English",
        definitions: [{ definition: html, parsedExamples: example ? [{ example }] : [] }],
      },
    ],
  };
}

const FORM_OF_GO =
  '<span class="form-of-definition use-with-mention">simple past of <span class="form-of-definition-link"><i class="Latn mention" lang="en"><a rel="mw:WikiLink" href="/wiki/go#English" title="go">go</a></i></span></span>';

describe("lookupWord when the Free Dictionary is down", () => {
  function net(calls: string[]) {
    return async (url: string) => {
      calls.push(url);
      if (url.includes("dictionaryapi.dev")) return new Response("Something Went Wrong", { status: 502 });
      const word = decodeURIComponent(url.split("/").pop() ?? "");
      if (word === "went") return Response.json(wiktionaryEntry("Verb", FORM_OF_GO));
      if (word === "go") {
        return Response.json(
          wiktionaryEntry(
            "Verb",
            'To <a href="/wiki/move" title="move">move</a> &amp; travel.',
            "Let's <b>go</b>!",
          ),
        );
      }
      if (word === "give_up") return Response.json(wiktionaryEntry("Verb", "To surrender."));
      return Response.json({ status: 404 }, { status: 404 });
    };
  }

  it("falls back to Wiktionary, stripping its markup, and asks the broken one only once", async () => {
    const calls: string[] = [];
    const outcome = await lookupWord("go", net(calls));
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.entry.meanings, [
      { partOfSpeech: "verb", definitions: [{ definition: "To move & travel.", example: "Let's go!" }] },
    ]);
    assert.equal(calls.filter((url) => url.includes("dictionaryapi.dev")).length, 1);
  });

  it("follows an entry that is only a form of another word to that word", async () => {
    const outcome = await lookupWord("went", net([]));
    assert.ok(outcome.ok);
    assert.equal(outcome.entry.word, "go");
  });

  it("stops asking the Free Dictionary for a while once it has failed", async () => {
    const calls: string[] = [];
    let clock = 1_000;
    await lookupWord("go", net(calls), () => clock);
    await lookupWord("give up", net(calls), () => clock);
    assert.equal(calls.filter((url) => url.includes("dictionaryapi.dev")).length, 1);

    clock += 6 * 60_000;
    await lookupWord("go", net(calls), () => clock);
    assert.equal(calls.filter((url) => url.includes("dictionaryapi.dev")).length, 2);
  });

  it("looks phrases up with Wiktionary's underscores", async () => {
    const outcome = await lookupWord("give up", net([]));
    assert.ok(outcome.ok);
    assert.equal(outcome.entry.meanings[0].definitions[0].definition, "To surrender.");
  });

  it("says not found, not failed, when Wiktionary answered that it has nothing", async () => {
    assert.deepEqual(await lookupWord("blorp", net([])), { ok: false, reason: "not-found" });
  });
});

describe("fromWiktionary", () => {
  it("keeps a word's own meaning, listing the 'form of' line with it", () => {
    const { entry, lemma } = fromWiktionary("went", {
      en: [
        { partOfSpeech: "Verb", definitions: [{ definition: FORM_OF_GO }] },
        { partOfSpeech: "Noun", definitions: [{ definition: "A path; a journey." }] },
      ],
    });
    assert.equal(lemma, "go");
    assert.deepEqual(
      entry?.meanings.map((meaning) => [meaning.partOfSpeech, meaning.definitions[0].definition]),
      [
        ["verb", "simple past of go"],
        ["noun", "A path; a journey."],
      ],
    );
  });

  it("leads with the part of speech it was asked to prefer", () => {
    const { entry } = fromWiktionary(
      "stranger",
      {
        en: [
          { partOfSpeech: "Adjective", definitions: [{ definition: "more strange" }] },
          { partOfSpeech: "Noun", definitions: [{ definition: "A person one does not know." }] },
        ],
      },
      "noun",
    );
    assert.equal(entry?.meanings[0].partOfSpeech, "noun");
  });

  it("merges sections that share a part of speech", () => {
    const { entry } = fromWiktionary("bear", {
      en: [
        { partOfSpeech: "Verb", definitions: [{ definition: "To carry." }] },
        { partOfSpeech: "Noun", definitions: [{ definition: "A large mammal." }] },
        { partOfSpeech: "Verb", definitions: [{ definition: "To put up with." }] },
      ],
    });
    assert.deepEqual(
      entry?.meanings.map((meaning) => [meaning.partOfSpeech, meaning.definitions.length]),
      [
        ["verb", 2],
        ["noun", 1],
      ],
    );
  });

  it("reads only the English section", () => {
    const { entry } = fromWiktionary("chat", {
      fr: [{ partOfSpeech: "Noun", definitions: [{ definition: "cat" }] }],
    });
    assert.equal(entry, null);
  });
});
