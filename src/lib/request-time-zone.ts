import { cookies } from "next/headers";

import { safeTimeZone } from "@/lib/game";

/** Set by `TimeZoneSync` in the browser, so "today" is the player's today. */
export const TIME_ZONE_COOKIE = "tz";

/** The player's time zone for this request, or UTC until the browser has told us. */
export async function requestTimeZone(): Promise<string> {
  const store = await cookies();
  return safeTimeZone(store.get(TIME_ZONE_COOKIE)?.value);
}
