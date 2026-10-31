/**
 * Blitz: a timed multiple-choice round built from a deck's own cards.
 *
 * Like practice it sits outside the scheduler -- nothing here is written to a
 * card -- so it can be played as often as you like without moving due dates.
 */
import { shuffled } from "@/lib/shuffle";

export interface BlitzCard {
  id: string;
  front: string;
  back: string;
}

export interface BlitzQuestion {
  cardId: string;
  prompt: string;
  options: string[];
  /** Index into `options` of the right answer. */
  correct: number;
}

/** Fewer cards than this and there are not enough wrong answers to choose from. */
export const MIN_BLITZ_CARDS = 4;
export const BLITZ_SECONDS = 60;
export const BLITZ_HEARTS = 3;

/**
 * "(Adjective) Honest and direct." -> { label: "Adjective", text: "Honest and direct." }
 *
 * The vocabulary decks open each answer with the part of speech in brackets.
 * The review card shows it as a chip; Blitz drops it, since "(Verb)" next to a
 * verb would give the answer away.
 */
export function splitLabel(back: string): { label: string | null; text: string } {
  const match = /^\s*\(([^)]{1,40})\)\s*([\s\S]+)$/.exec(back);
  if (!match) return { label: null, text: back.trim() };
  return { label: match[1].trim(), text: match[2].trim() };
}

/** The answer as a Blitz option: no label, one line, not too long. */
export function optionText(back: string, max = 120): string {
  const flat = splitLabel(back).text.replace(/\s+/g, " ");
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The question for `cards[index]`: its answer plus up to three others from the deck. */
export function buildQuestion(
  cards: readonly BlitzCard[],
  index: number,
  random: () => number = Math.random,
): BlitzQuestion {
  const card = cards[index];
  const answer = optionText(card.back);
  const others = cards
    .filter((_, i) => i !== index)
    .map((other) => optionText(other.back))
    .filter((text) => text !== answer);
  const distractors = [...new Set(shuffled(others, random))].slice(0, 3);
  const options = shuffled([answer, ...distractors], random);
  return { cardId: card.id, prompt: card.front, options, correct: options.indexOf(answer) };
}

/** 100 a right answer, doubled from 3 in a row and tripled from 6. */
export function blitzPoints(streak: number): number {
  if (streak >= 6) return 300;
  if (streak >= 3) return 200;
  return 100;
}
