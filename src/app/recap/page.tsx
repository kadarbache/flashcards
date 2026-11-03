import { RecapView } from "@/components/recap-view";
import { SetupNotice } from "@/components/setup-notice";
import { getRecap, type RecapPage as RecapData } from "@/lib/recap-db";
import { requestTimeZone } from "@/lib/request-time-zone";

/** The week depends on the date, so the page is never prerendered. */
export const dynamic = "force-dynamic";

export default async function RecapPage({ searchParams }: PageProps<"/recap">) {
  const { week } = await searchParams;
  const timeZone = await requestTimeZone();

  let page: RecapData;
  try {
    page = await getRecap(timeZone, typeof week === "string" ? week : null);
  } catch (error) {
    return <SetupNotice error={error} />;
  }

  return <RecapView page={page} />;
}
