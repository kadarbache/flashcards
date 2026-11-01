import { timingSafeEqual } from "node:crypto";

import { runReminders } from "@/lib/reminders-db";

/**
 * GET /api/cron/reminders
 *
 * The evening reminder job. Vercel Cron calls it on the schedule in
 * `vercel.json` and sends `Authorization: Bearer <CRON_SECRET>`. Anyone else
 * gets a 401, and without a CRON_SECRET it answers 503: failing closed, the
 * same as the decks API without its key.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  }

  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    return Response.json(await runReminders());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return Response.json({ error: message }, { status: 500 });
  }
}
