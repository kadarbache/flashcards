import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blitzPoints, buildQuestion, optionText, splitLabel } from "@/lib/blitz";

const cards = [
  { id: "1", front: "frank", back: "(Adjective) Honest and direct in speech." },
  { id: "2", front: "annex", back: "(Verb) To take control of territory." },
  { id: "3", front: "overnight", back: "During the night." },
  { id: "4", front: "tendency", back: "(Noun) A natural habit." },
  { id: "5", front: "deviations", back: "(Noun) Changes from the normal course." },
];

describe("splitLabel", () => {
  it("pulls the part of speech off the front of an answer", () => {
    assert.deepEqual(splitLabel("(Phrasal verb) To rise to a challenge."), {
      label: "Phrasal verb",
      text: "To rise to a challenge.",
    });
  });

  it("leaves an answer without one alone", () => {
    assert.deepEqual(splitLabel("During the night."), { label: null, text: "During the night." });
  });
});

describe("optionText", () => {
  it("drops the label and shortens long answers", () => {
    assert.equal(optionText("(Noun) A natural habit."), "A natural habit.");
    const long = optionText(`(Noun) ${"word ".repeat(60)}`, 40);
    assert.equal(long.length, 40);
    assert.ok(long.endsWith("…"));
  });
});

describe("buildQuestion", () => {
  it("offers the right answer and three different wrong ones", () => {
    const question = buildQuestion(cards, 0, () => 0.3);
    assert.equal(question.prompt, "frank");
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.equal(question.options[question.correct], "Honest and direct in speech.");
  });

  it("skips other cards whose answer is the same text", () => {
    const twins = [
      { id: "a", front: "one", back: "Same answer." },
      { id: "b", front: "two", back: "Same answer." },
      { id: "c", front: "three", back: "Other answer." },
    ];
    const question = buildQuestion(twins, 0);
    assert.deepEqual([...question.options].sort(), ["Other answer.", "Same answer."]);
  });
});

describe("blitzPoints", () => {
  it("doubles from three in a row and triples from six", () => {
    assert.equal(blitzPoints(1), 100);
    assert.equal(blitzPoints(3), 200);
    assert.equal(blitzPoints(7), 300);
  });
});
