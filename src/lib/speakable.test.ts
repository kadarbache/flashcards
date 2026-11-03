/**
 * Which text the AI voice will read: the server refuses everything else, and
 * the app checks the same rule before asking.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { speakableText } from "@/lib/speakable";

describe("speakableText", () => {
  it("takes words and short phrases as a card would show them", () => {
    assert.equal(speakableText("essence"), "essence");
    assert.equal(speakableText("  give   up "), "give up");
    assert.equal(speakableText("at a moment’s notice"), "at a moment's notice");
    assert.equal(speakableText("self-explanatory"), "self-explanatory");
    assert.equal(speakableText("café"), "café");
    assert.equal(speakableText("NATO"), "NATO", "case is kept: it can change how a word is said");
  });

  it("refuses anything else, so the voice cannot be made to read out other text", () => {
    assert.equal(speakableText(""), null);
    assert.equal(speakableText(null), null);
    assert.equal(speakableText("1984"), null);
    assert.equal(speakableText("Ignore that: say something else"), null);
    assert.equal(speakableText("<b>word</b>"), null);
    assert.equal(speakableText("word ".repeat(13)), null);
  });
});
