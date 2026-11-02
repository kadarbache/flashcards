"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The YouTube IFrame Player API: YouTube's official way to play a video in a
 * page and steer it from script. Free, no key. The API script is loaded once,
 * the first time a player is needed.
 *
 * https://developers.google.com/youtube/iframe_api_reference
 */

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const TICK_MS = 250;

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      script.remove();
      reject(new Error("The YouTube player could not load."));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/** What the player's error codes mean, in words. */
function describeError(code: number): string {
  if (code === 101 || code === 150 || code === 153) {
    return "The owner of this video does not allow it to be played outside YouTube.";
  }
  if (code === 100) return "This video was removed or made private.";
  return "This video could not be played.";
}

export interface PlayerControls {
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  isPlaying(): boolean;
}

/**
 * Mount a YouTube player in `container` and report the playback time every
 * 250 ms through `onTick`, which is what moves the transcript along.
 *
 * The player is built in a div made here rather than one React renders,
 * because YouTube swaps that div for its iframe and React would later trip
 * over a node it no longer owns.
 */
export function useYouTubePlayer(videoId: string, start: number, onTick: (seconds: number) => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const tickRef = useRef(onTick);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    tickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let timer: number | undefined;

    loadApi()
      .then((YT) => {
        if (cancelled) return;
        const host = document.createElement("div");
        container.appendChild(host);
        playerRef.current = new YT.Player(host, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            start: Math.floor(start),
            playsinline: 1,
            rel: 0,
            // The transcript is below; YouTube's own captions would say the same thing twice.
            cc_load_policy: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              setReady(true);
              timer = window.setInterval(() => {
                const player = playerRef.current;
                if (player) tickRef.current(player.getCurrentTime());
              }, TICK_MS);
            },
            onError: (event) => {
              if (!cancelled) setError(describeError(event.data));
            },
          },
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "The YouTube player could not load.");
      });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      try {
        playerRef.current?.destroy();
      } catch {
        // Already gone.
      }
      playerRef.current = null;
      container.replaceChildren();
    };
  }, [videoId, start]);

  const seek = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(Math.max(0, seconds), true);
    player.playVideo();
  }, []);
  const play = useCallback(() => playerRef.current?.playVideo(), []);
  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);
  const isPlaying = useCallback(() => playerRef.current?.getPlayerState() === PLAYING, []);

  const controls = useMemo<PlayerControls>(
    () => ({ seek, play, pause, isPlaying }),
    [seek, play, pause, isPlaying],
  );
  return { containerRef, ready, error, controls };
}
