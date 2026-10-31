import { notFound } from "next/navigation";

import { BlitzSession } from "@/components/blitz-session";
import { SetupNotice } from "@/components/setup-notice";
import { getDeck, listPracticeCards, type DeckSettings, type PracticeCard } from "@/lib/decks";
import { isFrameworkControlFlow } from "@/lib/next-errors";

export default async function BlitzPage({ params }: PageProps<"/decks/[id]/blitz">) {
  const { id } = await params;

  let data: { deck: DeckSettings; cards: PracticeCard[] };
  try {
    const deck = await getDeck(id);
    if (!deck) notFound();
    data = { deck, cards: await listPracticeCards(id) };
  } catch (error) {
    if (isFrameworkControlFlow(error)) throw error;
    return <SetupNotice error={error} />;
  }

  return (
    <BlitzSession
      deckId={data.deck.id}
      deckName={data.deck.name}
      cards={data.cards}
      initialBest={data.deck.blitzBest}
    />
  );
}
