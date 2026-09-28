import { notFound } from "next/navigation";

import { ReviewSession } from "@/components/review-session";
import { SetupNotice } from "@/components/setup-notice";
import { isFrameworkControlFlow } from "@/lib/next-errors";
import { getDeck, getNextCard, type DeckSettings, type NextCardResult } from "@/lib/decks";

export default async function ReviewPage({ params }: PageProps<"/decks/[id]/review">) {
  const { id } = await params;

  let data: { deck: DeckSettings; queue: NextCardResult };
  try {
    const deck = await getDeck(id);
    if (!deck) notFound();
    data = { deck, queue: await getNextCard(id) };
  } catch (error) {
    if (isFrameworkControlFlow(error)) throw error;
    return <SetupNotice error={error} />;
  }

  return (
    <ReviewSession
      deckId={data.deck.id}
      deckName={data.deck.name}
      initial={data.queue}
    />
  );
}
