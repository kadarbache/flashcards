"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrowIcon, PlayIcon } from "@/components/icons";
import { iconButton } from "@/components/ui";
import { TranscriptUpload } from "@/components/watch/transcript-upload";
import { useYouTubePlayer } from "@/components/watch/use-youtube-player";
import { WordSheet, type DeckOption, type WordPick } from "@/components/watch/word-sheet";
import {
  activeLineIndex,
  formatTimestamp,
  normalizeWord,
  tokenize,
  type TranscriptLine,
} from "@/lib/transcript";
import type { SourceFailure } from "@/lib/transcript-sources";
import type { TranscriptOutcome, TranscriptView } from "@/lib/transcripts-db";

/** Why there is no transcript, in words. */
function failureText(reason: SourceFailure, backupConfigured: boolean): string {
  switch (reason) {
    case "no-captions":
      return "This video has no captions, so there is no transcript to fetch.";
    case "blocked":
      return backupConfigured
        ? "YouTube refused to hand over the captions, and the backup service could not get them either."
        : "YouTube refused to hand the captions to the server. It does this to most cloud servers. Setting SUPADATA_API_KEY turns on a backup service that gets around it.";
    case "unavailable":
      return "YouTube says this video is private, removed or restricted, so its captions are out of reach.";
    default:
      return "Something went wrong fetching the captions. Try again in a little while.";
  }
}

function sourceText(transcript: TranscriptView): string {
  if (transcript.source === "upload") return "Your transcript";
  const name = transcript.languageName || transcript.lang;
  return transcript.auto && !/auto/i.test(name) ? `${name} (auto-generated)` : name;
}

/**
 * The watch screen: the video on top (or on the left), the transcript beside
 * it. The line being spoken is highlighted and kept in view; tap a line's time
 * to jump there, tap a word to see what it means and add it to a deck.
 */
export function WatchSession({
  videoId,
  start,
  outcome,
  decks,
  knownWords,
  backupConfigured,
}: {
  videoId: string;
  start: number;
  outcome: TranscriptOutcome;
  decks: DeckOption[];
  knownWords: string[];
  backupConfigured: boolean;
}) {
  const [transcript, setTranscript] = useState<TranscriptView | null>(outcome.ok ? outcome.transcript : null);
  const [active, setActive] = useState(-1);
  const [follow, setFollow] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [known, setKnown] = useState(() => new Set(knownWords));
  const [pick, setPick] = useState<WordPick | null>(null);
  const resumeAfter = useRef(false);
  const pickCount = useRef(0);
  const list = useRef<HTMLOListElement>(null);

  const lines = useMemo(() => transcript?.lines ?? [], [transcript]);
  const timed = transcript?.timed ?? false;

  const onTick = useCallback(
    (seconds: number) => {
      if (!timed) return;
      const index = activeLineIndex(lines, seconds);
      setActive((current) => (current === index ? current : index));
    },
    [lines, timed],
  );
  const { containerRef, error: playerError, controls } = useYouTubePlayer(videoId, start, onTick);

  // Keep the spoken line a third of the way down the list. Scrolls the list
  // only, never the page, so the video stays where it is on a phone. While a
  // mouse is over the list it holds still, so a word does not slide away just
  // as it is clicked; it catches up when the mouse leaves.
  useEffect(() => {
    if (!follow || hovering || active < 0) return;
    const container = list.current;
    const row = container?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!container || !row) return;
    container.scrollTo({ top: row.offsetTop - container.clientHeight / 3, behavior: "smooth" });
  }, [active, follow, hovering]);

  const seek = useCallback(
    (seconds: number) => {
      controls.seek(seconds);
      setFollow(true);
    },
    [controls],
  );

  const open = useCallback(
    (word: string, sentence: string) => {
      resumeAfter.current = controls.isPlaying();
      controls.pause();
      pickCount.current += 1;
      setPick({ id: pickCount.current, word, sentence });
    },
    [controls],
  );

  const close = useCallback(() => {
    setPick(null);
    if (resumeAfter.current) controls.play();
    resumeAfter.current = false;
  }, [controls]);

  const added = useCallback((front: string) => {
    setKnown((current) => new Set(current).add(normalizeWord(front)));
  }, []);

  /**
   * One listener for the whole transcript rather than one per word: a long
   * video has tens of thousands of them. A selected phrase of a few words wins
   * over the word under the pointer, so "give up" can be looked up whole.
   */
  function onTranscriptClick(event: React.MouseEvent<HTMLOListElement>) {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-line]");
    if (!row) return;
    const line = lines[Number(row.dataset.line)];
    if (!line) return;

    const selected = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    const count = selected === "" ? 0 : selected.split(" ").length;
    if (count >= 2 && count <= 5 && selected.length <= 60) {
      open(selected.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""), line.text);
      return;
    }
    const word = target.closest<HTMLElement>("[data-word]")?.dataset.word;
    if (word) open(word, line.text);
  }

  const title = transcript?.title || (!outcome.ok ? outcome.title : "") || "YouTube video";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Link href="/watch" className={iconButton} aria-label="Back to videos">
          <ArrowIcon direction="left" className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl leading-tight font-extrabold tracking-tight break-words sm:text-2xl">
            {title}
          </h1>
          <p className="text-sm text-ink-muted">Tap any word to see what it means.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-3 lg:sticky lg:top-20">
          <div className="relative aspect-video overflow-hidden rounded-3xl bg-black">
            <div ref={containerRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
            {playerError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="font-bold">{playerError}</p>
                <a
                  href={`https://www.youtube.com/watch?v=${videoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-bold text-gold hover:underline"
                >
                  Open it on YouTube
                </a>
              </div>
            )}
          </div>
        </div>

        <section className="flex flex-col gap-3 rounded-3xl bg-surface-raised" aria-label="Transcript">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <h2 className="text-base font-extrabold">Transcript</h2>
            {transcript && <span className="text-xs font-bold text-ink-muted">{sourceText(transcript)}</span>}
          </div>

          {transcript ? (
            <div className="relative">
              <ol
                ref={list}
                onClick={onTranscriptClick}
                onWheel={() => setFollow(false)}
                onTouchMove={() => setFollow(false)}
                onPointerEnter={(event) => setHovering(event.pointerType === "mouse")}
                onPointerLeave={() => setHovering(false)}
                className="relative h-[52dvh] space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-16 lg:h-[calc(100dvh-14rem)]"
              >
                {lines.map((line, index) => (
                  <Line
                    key={index}
                    index={index}
                    line={line}
                    timed={timed}
                    active={index === active}
                    known={known}
                    onSeek={seek}
                  />
                ))}
              </ol>
              {timed && !follow && (
                <button
                  type="button"
                  onClick={() => setFollow(true)}
                  className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-extrabold text-paper-ink shadow-lg active:scale-95"
                >
                  <PlayIcon className="h-3.5 w-3.5" />
                  Follow the video
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4 px-5 pb-5">
              <p className="text-sm text-ink-muted">
                {!outcome.ok && failureText(outcome.reason, backupConfigured)}
              </p>
              <TranscriptUpload videoId={videoId} onSaved={setTranscript} />
            </div>
          )}

          {transcript && (
            <details className="border-t border-border-subtle px-5 py-3 text-sm">
              <summary className="cursor-pointer font-bold text-ink-muted">
                {sourceText(transcript)} · use my own subtitles instead
              </summary>
              <div className="pt-3">
                <TranscriptUpload videoId={videoId} onSaved={setTranscript} />
              </div>
            </details>
          )}
        </section>
      </div>

      <WordSheet pick={pick} decks={decks} onClose={close} onAdded={added} />
    </div>
  );
}

/**
 * One transcript line. Memoised, so as the video plays only the line that
 * stops being current and the one that starts re-render.
 */
const Line = memo(function Line({
  index,
  line,
  timed,
  active,
  known,
  onSeek,
}: {
  index: number;
  line: TranscriptLine;
  timed: boolean;
  active: boolean;
  known: Set<string>;
  onSeek: (seconds: number) => void;
}) {
  const tokens = useMemo(() => tokenize(line.text), [line.text]);
  return (
    <li
      data-line={index}
      className={`flex items-start gap-3 rounded-2xl px-3 py-2 transition-colors ${active ? "bg-surface-high" : ""}`}
    >
      {timed && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSeek(line.start);
          }}
          className={`mt-0.5 shrink-0 rounded-md px-1.5 text-xs font-bold tabular-nums transition hover:bg-surface-high ${
            active ? "text-gold" : "text-ink-muted"
          }`}
          aria-label={`Play from ${formatTimestamp(line.start)}`}
        >
          {formatTimestamp(line.start)}
        </button>
      )}
      <p className={`leading-relaxed ${active ? "text-ink" : "text-ink/80"}`}>
        {tokens.map((token, i) =>
          token.word ? (
            <span
              key={i}
              data-word={token.word}
              className={`cursor-pointer rounded-sm decoration-2 underline-offset-4 hover:bg-gold/20 hover:text-ink ${
                known.has(token.word) ? "underline decoration-gold/70 decoration-dotted" : ""
              }`}
            >
              {token.text}
            </span>
          ) : (
            <span key={i}>{token.text}</span>
          ),
        )}
      </p>
    </li>
  );
});
