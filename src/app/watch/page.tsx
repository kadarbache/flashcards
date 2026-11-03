import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SetupNotice } from "@/components/setup-notice";
import { ArrowIcon, VideoIcon } from "@/components/icons";
import { field, iconButton, panel, primaryButton } from "@/components/ui";
import { WatchSession } from "@/components/watch/watch-session";
import { listDecks } from "@/lib/decks";
import { parseStartTime, parseVideoId } from "@/lib/transcript";
import type { SavedCard } from "@/lib/transcript";
import {
  listSavedCards,
  listRecentVideos,
  getTranscript,
  type RecentVideo,
  type TranscriptOutcome,
} from "@/lib/transcripts-db";
import type { DeckOption } from "@/components/watch/word-sheet";

/** Transcripts are fetched and saved on the way in, so nothing here is prerendered. */
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * Watch a YouTube video with its transcript underneath. Without `?v=` it is
 * the start screen: paste a link, or pick a video watched before.
 */
export default async function WatchPage({ searchParams }: PageProps<"/watch">) {
  const params = await searchParams;
  const raw = first(params.v);

  if (raw === "") return <StartScreen />;

  const videoId = parseVideoId(raw);
  if (!videoId) return <StartScreen error="That does not look like a YouTube link." initial={raw} />;

  // A pasted link lands here as the whole URL. Tidy it to the id, keeping its start time.
  if (raw !== videoId) {
    let time = "";
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      time = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "";
    } catch {
      // No time then.
    }
    const query = new URLSearchParams({ v: videoId });
    const seconds = parseStartTime(time);
    if (seconds > 0) query.set("t", String(seconds));
    redirect(`/watch?${query}`);
  }

  const start = parseStartTime(first(params.t));

  let outcome: TranscriptOutcome;
  let decks: DeckOption[];
  let savedCards: SavedCard[];
  try {
    const [transcript, deckList, cards] = await Promise.all([
      getTranscript(videoId),
      listDecks(),
      listSavedCards(),
    ]);
    outcome = transcript;
    decks = deckList.map((deck) => ({ id: deck.id, name: deck.name }));
    savedCards = cards;
  } catch (error) {
    return <SetupNotice error={error} />;
  }

  return (
    <WatchSession
      key={videoId}
      videoId={videoId}
      start={start}
      outcome={outcome}
      decks={decks}
      savedCards={savedCards}
      backupConfigured={Boolean(process.env.SUPADATA_API_KEY)}
    />
  );
}

async function StartScreen({ error, initial = "" }: { error?: string; initial?: string }) {
  let recent: RecentVideo[] = [];
  try {
    recent = await listRecentVideos();
  } catch {
    // The list is a convenience; the link box works without the database.
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="anim-rise flex items-start gap-3">
        <Link href="/" className={iconButton} aria-label="Back to home">
          <ArrowIcon direction="left" className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Watch &amp; learn</h1>
          <p className="mt-1 text-ink-muted">
            Watch a YouTube video with its transcript. Tap a word you do not know to see what it means, and
            add it to a deck.
          </p>
        </div>
      </div>

      <Form action="/watch" className={`${panel} anim-rise space-y-3`}>
        <label htmlFor="watch-link" className="block text-sm font-semibold text-ink-muted">
          YouTube link
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="watch-link"
            name="v"
            defaultValue={initial}
            className={field}
            placeholder="https://www.youtube.com/watch?v=…"
            autoComplete="off"
            inputMode="url"
            required
          />
          <button type="submit" className={`${primaryButton} shrink-0`}>
            <VideoIcon className="h-5 w-5" />
            Watch
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm font-bold text-again">
            {error}
          </p>
        )}
      </Form>

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold">Watched lately</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recent.map((video) => (
              <li key={video.videoId}>
                <Link
                  href={`/watch?v=${video.videoId}`}
                  className="group flex items-center gap-3 rounded-2xl bg-surface-raised p-2.5 transition hover:bg-surface-high"
                >
                  {/* YouTube's own thumbnail; next/image would only re-host it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`}
                    alt=""
                    width={120}
                    height={68}
                    loading="lazy"
                    className="aspect-video w-28 shrink-0 rounded-xl bg-black object-cover"
                  />
                  <span className="line-clamp-2 min-w-0 text-sm font-bold">
                    {video.title || "Untitled video"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
