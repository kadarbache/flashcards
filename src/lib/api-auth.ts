/**
 * Shared-secret check for the HTTP API.
 *
 * The app itself has no sign-in, so these routes are the one place that accepts
 * writes from outside the browser. An unset key is treated as a misconfiguration
 * rather than "no auth needed": failing closed means deploying without setting
 * the key cannot quietly expose an open write endpoint.
 */
export type AuthFailure = { status: 401 | 503; message: string };

export function checkApiKey(request: Request): AuthFailure | null {
  const expected = process.env.FLASHCARDS_API_KEY;

  if (!expected || expected.trim() === "") {
    return {
      status: 503,
      message:
        "FLASHCARDS_API_KEY is not set on the server. Add it to .env.local and restart.",
    };
  }

  const provided =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!timingSafeEqual(provided, expected)) {
    return { status: 401, message: "Invalid or missing x-api-key header." };
  }

  return null;
}

/**
 * Compare without leaking the answer through how long it takes. Length is
 * compared first and does leak, which is fine: the length of a random key is
 * not the secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}
