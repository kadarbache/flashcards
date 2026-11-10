/**
 * Reading a chat answer's bit of Markdown.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseChatText, parseSpans, settleWriting } from "@/lib/chat-text";

describe("parseSpans", () => {
  it("splits out bold and italic runs", () => {
    assert.deepEqual(parseSpans("Use **parasocial** for a *one-sided* bond."), [
      { text: "Use " },
      { text: "parasocial", bold: true },
      { text: " for a " },
      { text: "one-sided", italic: true },
      { text: " bond." },
    ]);
  });

  it("leaves stray asterisks as they are", () => {
    assert.deepEqual(parseSpans("2 * 3 and an open **bold"), [{ text: "2 * 3 and an open **bold" }]);
  });
});

describe("parseChatText", () => {
  it("reads paragraphs and bullet lists, with single line breaks kept inside a paragraph", () => {
    assert.deepEqual(parseChatText("First line\nsame paragraph\n\n- one\n- **two**\n\nLast."), [
      { kind: "paragraph", lines: [[{ text: "First line" }], [{ text: "same paragraph" }]] },
      { kind: "list", ordered: false, items: [[{ text: "one" }], [{ text: "two", bold: true }]] },
      { kind: "paragraph", lines: [[{ text: "Last." }]] },
    ]);
  });

  it("reads numbered lists apart from bullet lists", () => {
    assert.deepEqual(parseChatText("1. first\n2) second\n* third"), [
      { kind: "list", ordered: true, items: [[{ text: "first" }], [{ text: "second" }]] },
      { kind: "list", ordered: false, items: [[{ text: "third" }]] },
    ]);
  });

  it("puts bullets run on after a sentence on lines of their own", () => {
    assert.deepEqual(parseChatText("Here are two:- I love it.- She hates it."), [
      { kind: "paragraph", lines: [[{ text: "Here are two:" }]] },
      { kind: "list", ordered: false, items: [[{ text: "I love it." }], [{ text: "She hates it." }]] },
    ]);
  });

  it("leaves dashes inside sentences alone", () => {
    assert.deepEqual(parseChatText("It is formal - mostly - and well-known."), [
      { kind: "paragraph", lines: [[{ text: "It is formal - mostly - and well-known." }]] },
    ]);
  });

  it("reads a heading as a bold line", () => {
    assert.deepEqual(parseChatText("## Examples"), [
      { kind: "paragraph", lines: [[{ text: "Examples", bold: true }]] },
    ]);
  });

  it("gives nothing for empty text", () => {
    assert.deepEqual(parseChatText("  \n\n "), []);
  });
});

describe("settleWriting", () => {
  it("closes an open bold and holds back a trailing asterisk while the answer is written", () => {
    assert.equal(settleWriting("You mean **prec"), "You mean **prec**");
    assert.equal(settleWriting("You mean **precise*"), "You mean **precise**");
    assert.equal(settleWriting("You mean *"), "You mean ");
    assert.equal(settleWriting("You mean **precise** here"), "You mean **precise** here");
    assert.equal(settleWriting("Plain text"), "Plain text");
  });
});
