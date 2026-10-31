import { notFound } from "next/navigation";

import { ReviewSession } from "@/components/review-session";
import { SetupNotice } from "@/components/setup-notice";
import { MIN_BLITZ_CARDS } from "@/lib/blitz";
import { getDeck, getNextCard, type DeckSettings, type NextCardResult } from "@/lib/decks";
import { isFrameworkControlFlow } from "@/lib/next-errors";
import { requestTimeZone } from "@/lib/request-time-zone";
import { getPlayerStats, type PlayerStats } from "@/lib/stats";

export default async function ReviewPage({ params }: PageProps<"/decks/[id]/review">) {
  const { id } = await params;
  const timeZone = await requestTimeZone();

  let data: { deck: DeckSettings; queue: NextCardResult; player: PlayerStats };
  try {
    const deck = await getDeck(id);
    if (!deck) notFound();
    const [queue, player] = await Promise.all([getNextCard(id), getPlayerStats(timeZone)]);
    data = { deck, queue, player };
  } catch (error) {
    if (isFrameworkControlFlow(error)) throw error;
    return <SetupNotice error={error} />;
  }

  const { counts } = data.queue;
  const cardCount = counts.newCards + counts.learning + counts.review + counts.scheduled;

  return (
    <ReviewSession
      deckId={data.deck.id}
      deckName={data.deck.name}
      initial={data.queue}
      initialPlayer={data.player}
      canBlitz={cardCount >= MIN_BLITZ_CARDS}
    />
  );
}
