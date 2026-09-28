import { auth } from "@/auth";

/**
 * The front door.
 *
 * This is `proxy.ts`, not `middleware.ts`. Next 16 deprecated the `middleware`
 * file convention and renamed it to `proxy` -- Auth.js's own documentation
 * still says to write `middleware.ts`, which in this version silently does
 * nothing. Proxy also defaults to the Node.js runtime here, which is why this
 * file can import the full auth config (bcrypt and all) instead of needing the
 * split edge-safe config Auth.js recommends for older versions.
 *
 * This is a redirect for humans, not the security boundary. Every Server Action
 * checks the session itself -- see `src/lib/auth-guard.ts`. A gate that lives
 * only in a proxy is one routing mistake, or one framework bug, away from being
 * no gate at all.
 */
export default auth((request) => {
  if (request.auth) return;

  const target = new URL("/login", request.nextUrl.origin);
  // Send them back where they were headed once they are in.
  target.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  return Response.redirect(target);
});

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api/auth  -- the sign-in endpoints themselves, or nobody could log in
     *   api/decks -- the bulk-import API, which authenticates with its own
     *                x-api-key header; gating it on a browser cookie would
     *                break every Postman call
     *   login     -- the form
     *   _next, favicon -- assets, which would otherwise redirect and leave the
     *                     login page unstyled
     */
    "/((?!api/auth|api/decks|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
