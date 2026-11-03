import { BossFight } from "@/components/boss-fight";
import { SetupNotice } from "@/components/setup-notice";
import { getBossScreen, type BossScreen } from "@/lib/boss-db";
import { aiVoiceReady } from "@/lib/pronunciation";
import { requestTimeZone } from "@/lib/request-time-zone";

/** The boss depends on the date, so the page is never prerendered. */
export const dynamic = "force-dynamic";

export default async function BossPage() {
  const timeZone = await requestTimeZone();

  let data: BossScreen;
  try {
    data = await getBossScreen(timeZone);
  } catch (error) {
    return <SetupNotice error={error} />;
  }

  return <BossFight data={data} aiVoice={aiVoiceReady()} />;
}
