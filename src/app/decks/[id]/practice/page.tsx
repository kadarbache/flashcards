import { notFound } from "next/navigation";

import { PracticeSession } from "@/components/practice-session";
import { SetupNotice } from "@/components/setup-notice";
import { isFrameworkControlFlow } from "@/lib/next-errors";
import {
  getDeck,
  listPracticeCards,
  type DeckSettings,
  type PracticeCard,
} from "@/lib/decks";

export default async function PracticePage({
  params,
}: PageProps<"/decks/[id]/practice">) {
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
    <PracticeSession
      deckId={data.deck.id}
      deckName={data.deck.name}
      cards={data.cards}
    />
  );
}
