# Flashcards

An Anki-style spaced-repetition app: decks of cards, a review session graded
with **Again / Hard / Good / Easy**, and a scheduler that decides when each card
comes back.

Next.js 16 (App Router) · MongoDB via Mongoose · Tailwind v4 · Google Sans · TypeScript.

## Getting started

```bash
npm install
cp .env.example .env.local   # then paste your MongoDB Atlas URI
npm run dev
```

In Atlas: **Connect → Drivers**, copy the connection string, replace
`<password>`, and add your IP under **Network Access**. The database and its
collections are created on first write. If the app cannot reach MongoDB it says
so on screen instead of throwing a stack trace.

```bash
npm test          # unit + integration tests
npm run lint
```

## How the scheduling works

Every card carries four numbers and a state: an **interval** in days, an **ease**
multiplier, a **due** date, and where it is in its lifecycle (`new`, `learning`,
`review`, `relearning`).

**New cards** walk a short learning ladder — 1 minute, then 10 minutes — before
they get a real interval. `Good` moves up a rung, `Again` drops back to the
first, `Hard` repeats the current one, and `Easy` skips the ladder entirely and
graduates the card with a 4-day interval. Ease is deliberately left alone during
learning: a card being learned has not earned a meaningful ease yet.

**Graduated cards** follow SM-2:

| Button | Next interval | Ease |
| ------ | ------------- | ---- |
| Again  | back to relearning, interval reset | −0.20 |
| Hard   | interval × 1.2 | −0.15 |
| Good   | interval × ease | unchanged |
| Easy   | interval × ease × 1.3 | +0.15 |

Two details that matter:

- **Ease has a floor of 1.3.** Below roughly that, intervals stop growing
  usefully and a card you keep failing would otherwise spiral into being shown
  forever.
- **Intervals are computed with the ease the card came in with**, and the ease
  adjustment applies to the *next* review. Doing it the other way round makes an
  `Easy` answer compound twice in one press.

A **±5% fuzz** is applied to intervals of 2.5 days and up, so a batch of cards
learned in one sitting does not come back as one indivisible clump months later.
Shorter intervals are left alone — spreading a one-day interval by 5% moves it
by an hour, which is noise.

Successful answers can never shorten an interval, and everything is capped at
100 years.

## Layout

```
src/lib/srs/          the scheduler — pure, no database, no React
  types.ts            ReviewState, SchedulerConfig, DEFAULT_CONFIG
  scheduler.ts        review(card, grade) -> card
  scheduler.test.ts   43 unit tests
src/lib/
  decks.ts            queries: deck lists, the review queue, card lists
  review.ts           answer a stored card and write history
  import.ts           pasted text -> cards (pure)
  db/                 Mongoose connection and models
src/app/
  actions.ts          Server Actions (thin wrappers over lib/)
  page.tsx            deck list
  decks/[id]/         deck detail: import, settings, cards
  decks/[id]/review/  the review session
```

The scheduler is a pure `(card, button) -> card` function with `now` and the
random source injected, which is what makes the behaviour above testable without
a database or a browser — and what would let you swap in **FSRS** later by
replacing one module. Nothing outside `src/lib/srs` knows how intervals are
chosen.

## The review queue

`getNextCard` serves, in order: **learning cards that are due**, then **due
reviews**, then **new cards**. Learning cards jump the queue because their steps
are minutes wide — making you wait out a pile of reviews would blow straight
past a one-minute step.

**There is no daily cap on new cards, by design.** This app reviews words that
were learned somewhere else — the vocabulary notes come first, the cards are the
review layer. Every card added is therefore already known and belongs in
rotation straight away. A daily cap would only make sense if the app were also
the place you met a word for the first time.

Grading returns the next card from the server, so the client never has to work
out whether a one-minute step has come back around. When nothing is due but a
card is a minute away, the screen counts down and pulls it in when it lands.

### The review screen

The card flips in 3D to reveal the answer, and the four grade buttons carry the
interval each one would give. Keyboard: **space** flips, **1-4** grade,
**left arrow** undoes, **right arrow** skips.

- **Undo** restores the card from a complete snapshot taken before the answer --
  state, step, interval, ease, due date, lapses and reps -- then deletes the
  history row, which also refunds the new-card allowance it consumed. A partial
  record would quietly lose the ease drop, so the whole of it is stored.
- **Skip** sets a card aside for this session only. Skipped cards are filtered
  out of the draw but stay in the counts, because they really are still due.

The two writes behind an answer -- the history row and the card -- are not
atomic, since transactions would need a replica set and that rules out a
standalone test server. The history row is written **first** on purpose: if it
fails the card is untouched and the answer simply does not count, whereas the
other order would move the card with no way to undo it.

## HTTP API

For loading cards in bulk from outside the app -- Postman, a script, whatever.

Every request needs the shared secret from `FLASHCARDS_API_KEY` as an
`x-api-key` header (`Authorization: Bearer ...` works too). If the server has no
key configured the API answers **503**, not 200: failing closed means deploying
without setting a key cannot quietly leave an open write endpoint.

`{deck}` below is either the deck's **id or its exact name**, so a batch can be
posted without looking an id up first.

### Create a deck

```
POST /api/decks
{ "name": "English vocabulary" }
```

201 with the new deck, or 409 if the name is taken (the response carries the
existing `deckId`, so a clash is recoverable without another request).

### Add many cards at once

```
POST /api/decks/{deck}/cards
{ "cards": [
    { "front": "hola",    "back": "hello" },
    { "question": "agua", "answer": "water" }
] }
```

- A bare array works too -- the `cards` wrapper is optional.
- `question`/`answer` are accepted alongside `front`/`back`.
- **Valid cards are inserted even when others in the batch are not.** The
  response says what happened to each one, and rejections carry the index of the
  offending entry.
- Fronts already in the deck are skipped, so **re-posting a batch does not
  duplicate it**. A batch that adds nothing answers 200 rather than 201.

```json
{
  "deck":  { "id": "...", "name": "Spanish basics" },
  "added": 2,
  "skipped": {
    "alreadyInDeck": 0,
    "repeatedInBatch": 0,
    "invalid": [{ "index": 2, "reason": "front and back must not be empty" }]
  },
  "cards": [{ "id": "...", "front": "hola", "back": "hello" }]
}
```

### Read a deck back

```
GET /api/decks            list decks with ids and counts
GET /api/decks/{deck}/cards
```

Cards created through the API are ordinary new cards: they enter the learning
ladder on first review like any other. The API, the paste import and the
"Add a card" form all go through the same insert path in `src/lib/cards.ts`, so
validation and de-duplication behave identically whichever one you use.

## Importing

The deck page has two ways in: **Add a card**, with separate Question and Answer
fields for typing one at a time, and **Import many** for a paste or a file. For
bulk loading from outside the app, see the HTTP API above.

Paste one card per line, front and back separated by a tab (or comma, semicolon,
pipe). A line containing a tab is always split on the tab — that is what a
spreadsheet paste gives you. Quoted CSV fields are honoured, `#` lines are
ignored, and anything unusable is reported with its line number rather than
silently dropped. Fronts already in the deck are skipped, so re-pasting a list
is harmless.

## Signing in

The web app is behind a single account, using Auth.js (`next-auth` v5) with a
Credentials provider. There is no user collection: the account is two
environment variables, because a table that only ever holds one row is a table
that only ever holds one row.

```bash
npm run set-password
```

That asks for an email and a password (not echoed), writes `AUTH_USER_EMAIL`
and a bcrypt hash of the password to `.env.local`, and generates `AUTH_SECRET`
if it is missing. Restart the server afterwards.

**Escape the `$` signs if you write the hash by hand.** Dotenv expands `$NAME`
as a variable reference -- in double quotes, in single quotes and unquoted
alike -- and a bcrypt hash looks like `$2b$12$...`, so an unescaped one is read
as three undefined variables and arrives as an empty string. Nothing warns you;
the app just says no account is configured. Written by hand it is
`AUTH_PASSWORD_HASH="\$2b\$12\$..."`. On Vercel, paste the hash raw -- host
environment variables are not expanded, so backslashes there would become part
of the password hash.

### Where the check happens

Three layers, deliberately:

- **`src/proxy.ts`** redirects signed-out browsers to `/login`, keeping the
  path they wanted so they land where they meant to. This is `proxy.ts` and not
  `middleware.ts`: Next 16 deprecated the `middleware` convention and renamed
  it, and Auth.js's own documentation has not caught up -- a `middleware.ts`
  here does nothing at all. Proxy also runs on the Node.js runtime by default
  in Next 16, so none of the usual edge-safe config splitting is needed.
- **Every Server Action** calls `requireSession()` first. Actions are POST
  endpoints that can be hit directly without a page ever rendering, and a gate
  that lives only in middleware is one routing mistake away from being no gate.
- **`verifyOwner`** always runs a bcrypt comparison, even when the email is
  already known to be wrong, against a hash nothing matches. Returning early
  would make an unknown address answer in microseconds and the real one take
  the ~200ms bcrypt costs, which turns the form into an oracle for which
  address owns the account.

Missing configuration locks everyone out rather than letting anyone in: with no
`AUTH_USER_EMAIL` or `AUTH_PASSWORD_HASH`, `verifyOwner` rejects every attempt
and the login page says so instead of silently accepting.

### The HTTP API is separate

`/api/decks/**` is excluded from the sign-in gate and keeps its own
`x-api-key` check, because it is called from Postman and scripts that have no
browser cookie. Gating it on a session would break every batch import. It fails
closed too: no `FLASHCARDS_API_KEY` configured means **503**, never 200.
