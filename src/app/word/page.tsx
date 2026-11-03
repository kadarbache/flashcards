import { SetupNotice } from "@/components/setup-notice";
import { WordOfTheDaySession } from "@/components/word-of-the-day";
import { aiVoiceReady } from "@/lib/pronunciation";
import { requestTimeZone } from "@/lib/request-time-zone";
import { getWordOfTheDay, type WordOfTheDay } from "@/lib/word-of-the-day-db";

/** Today's word depends on the date, so the page is never prerendered. */
export const dynamic = "force-dynamic";

export default async function WordOfTheDayPage() {
  const timeZone = await requestTimeZone();

  let data: WordOfTheDay;
  try {
    data = await getWordOfTheDay(timeZone);
  } catch (error) {
    return <SetupNotice error={error} />;
  }

  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date());

  return <WordOfTheDaySession data={data} dateLabel={dateLabel} aiVoice={aiVoiceReady()} />;
}
