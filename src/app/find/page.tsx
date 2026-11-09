import type { Metadata, Viewport } from "next";

import { SetupNotice } from "@/components/setup-notice";
import { WordFinder } from "@/components/word-finder";
import { aiVoiceReady } from "@/lib/pronunciation";
import { countFinderCards } from "@/lib/word-finder-db";

export const metadata: Metadata = { title: "Find a word · Flashcards" };

/**
 * The box to type in is fixed to the bottom of the screen. On Android this
 * makes the keyboard shrink the page rather than slide over it, so the box
 * sits right on top of the keyboard. iPhones ignore it and scroll the box
 * into view instead. Merged with the root layout's viewport.
 */
export const viewport: Viewport = { interactiveWidget: "resizes-content" };

/** The card count changes as cards are added, so the page is never prerendered. */
export const dynamic = "force-dynamic";

export default async function FindPage() {
  let cardCount: number;
  try {
    cardCount = await countFinderCards();
  } catch (error) {
    return <SetupNotice error={error} />;
  }

  return (
    <WordFinder cardCount={cardCount} ready={Boolean(process.env.GEMINI_API_KEY)} aiVoice={aiVoiceReady()} />
  );
}
