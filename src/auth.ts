import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { ownerFromEnv, verifyOwner } from "@/lib/credentials";

/**
 * Auth.js v5. One account, defined by `AUTH_USER_EMAIL` and
 * `AUTH_PASSWORD_HASH`, so there is no adapter and no user collection --
 * sessions are signed JWTs in a cookie and the database stays purely about
 * flashcards.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  // The default is a generated page listing providers; with one provider that
  // page is just a worse version of our own form.
  pages: { signIn: "/login" },

  // No adapter, so there is nowhere to store a database session.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },

  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      /**
       * Returning `null` is how Auth.js says "rejected"; it surfaces as a
       * `CredentialsSignin` error. We never say which half was wrong, because
       * "no such user" and "wrong password" are different answers only to
       * someone who does not already know the answer.
       */
      async authorize(credentials) {
        const owner = ownerFromEnv();
        const ok = await verifyOwner(credentials?.email, credentials?.password, owner);
        if (!ok || owner === null) return null;
        return { id: "owner", email: owner.email, name: "Owner" };
      },
    }),
  ],
});
