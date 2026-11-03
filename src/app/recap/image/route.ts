import { auth } from "@/auth";
import { getRecap } from "@/lib/recap-db";
import { recapImage } from "@/lib/recap-image";
import { requestTimeZone } from "@/lib/request-time-zone";

/**
 * GET /recap/image?week=2026-11-02
 *
 * The weekly recap as a PNG, for sharing. Your numbers are private, so it
 * needs a session like every page.
 */
export async function GET(request: Request) {
  // The proxy sends visitors to the login page; this is the check that counts.
  const session = await auth();
  if (!session?.user) return new Response(null, { status: 401 });

  const week = new URL(request.url).searchParams.get("week");
  const { recap } = await getRecap(await requestTimeZone(), week);
  return recapImage(recap);
}
