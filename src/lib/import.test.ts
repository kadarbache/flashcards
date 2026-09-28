import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCards } from "./import.ts";

describe("parseCards", () => {
  it("splits tab-separated lines", () => {
    const { cards, skipped } = parseCards("bonjour\thello\nmerci\tthank you");
    assert.deepEqual(cards, [
      { front: "bonjour", back: "hello" },
      { front: "merci", back: "thank you" },
    ]);
    assert.deepEqual(skipped, []);
  });

  it("splits on the chosen separator", () => {
    const { cards } = parseCards("bonjour,hello", { separator: "comma" });
    assert.deepEqual(cards, [{ front: "bonjour", back: "hello" }]);
  });

  it("prefers a tab even when another separator is chosen", () => {
    // A spreadsheet paste is tab-separated, and the back may contain commas.
    const { cards } = parseCards("bonjour\thello, hi", { separator: "comma" });
    assert.deepEqual(cards, [{ front: "bonjour", back: "hello, hi" }]);
  });

  it("keeps commas inside quoted fields", () => {
    const { cards } = parseCards('"a, b",c', { separator: "comma" });
    assert.deepEqual(cards, [{ front: "a, b", back: "c" }]);
  });

  it("unescapes doubled quotes", () => {
    const { cards } = parseCards('"say ""hi""",greet', { separator: "comma" });
    assert.deepEqual(cards, [{ front: 'say "hi"', back: "greet" }]);
  });

  it("ignores extra columns beyond front and back", () => {
    const { cards, skipped } = parseCards("a\tb\tc\td");
    assert.deepEqual(cards, [{ front: "a", back: "b" }]);
    assert.deepEqual(skipped, []);
  });

  it("skips blank lines silently", () => {
    const { cards, skipped } = parseCards("a\tb\n\n   \nc\td");
    assert.equal(cards.length, 2);
    assert.deepEqual(skipped, []);
  });

  it("skips comment lines silently", () => {
    const { cards, skipped } = parseCards("# front\tback\na\tb");
    assert.deepEqual(cards, [{ front: "a", back: "b" }]);
    assert.deepEqual(skipped, []);
  });

  it("reports a line with no separator, with its line number", () => {
    const { cards, skipped } = parseCards("a\tb\njust one field\nc\td");
    assert.equal(cards.length, 2);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].line, 2);
    assert.equal(skipped[0].text, "just one field");
    assert.match(skipped[0].reason, /tab/);
  });

  it("reports a line whose back is empty", () => {
    const { skipped } = parseCards("a\t   ");
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /empty/);
  });

  it("reports duplicate fronts within one paste, case-insensitively", () => {
    const { cards, skipped } = parseCards("a\tb\nA\tc");
    assert.equal(cards.length, 1);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /duplicate/);
  });

  it("handles Windows and classic Mac line endings", () => {
    const { cards } = parseCards("a\tb\r\nc\td\re\tf");
    assert.equal(cards.length, 3);
  });

  it("trims surrounding whitespace on both sides", () => {
    const { cards } = parseCards("  a  \t  b  ");
    assert.deepEqual(cards, [{ front: "a", back: "b" }]);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(parseCards(""), { cards: [], skipped: [] });
  });
});
