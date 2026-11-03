/**
 * The AI voice's clips on this device. Each word's clip is asked for once:
 * every later tap replays it from memory until the page is closed, and a tap
 * while it is still on its way waits for that same request rather than
 * sending another.
 *
 * Plain logic around an audio element passed in, so it can be tested without
 * a browser.
 */

/** The parts of an audio element this needs. */
export interface Clip extends EventTarget {
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
}

/** How a tap went: the clip played, there was none in time (speak another way), or the wait was called off. */
export type Outcome = "played" | "failed" | "stopped";

export interface Attempt {
  /** True when the clip has to come from the server first. */
  waiting: boolean;
  result: Promise<Outcome>;
  /** Stop waiting, e.g. because the card moved on. The clip still loads, for next time. */
  stop(): void;
}

export interface ClipPlayerOptions {
  /** Makes the element for a URL: `new Audio(url)` in the browser. */
  load: (url: string) => Clip;
  /** How long a tap waits for a new clip before the device speaks instead. */
  waitMs?: number;
  /** How many clips to hold; each is about a second of sound, some 50 KB. */
  maxClips?: number;
  now?: () => number;
}

/** A request with no answer after this long is taken as lost, and the next tap asks again. */
const LOST_MS = 60_000;

export function createClipPlayer({ load, waitMs = 10_000, maxClips = 60, now = Date.now }: ClipPlayerOptions) {
  /** Clips that have arrived, by text, most recently heard last. */
  const ready = new Map<string, Clip>();
  /** Clips on their way, by text. */
  const coming = new Map<string, { clip: Clip; since: number }>();

  function keep(text: string, clip: Clip) {
    ready.delete(text);
    ready.set(text, clip);
    if (ready.size > maxClips) ready.delete(ready.keys().next().value as string);
  }

  /** The clip on its way for `text`, asking the server only when none is. */
  function fetchOnce(text: string): Clip {
    const known = coming.get(text);
    if (known && now() - known.since < LOST_MS) return known.clip;

    const clip = load(`/api/speech?text=${encodeURIComponent(text)}`);
    coming.set(text, { clip, since: now() });
    let finished = false;
    const finish = (arrived: boolean) => {
      if (finished) return;
      finished = true;
      if (coming.get(text)?.clip === clip) coming.delete(text);
      if (arrived) keep(text, clip);
    };
    // Kept once it has loaded, even if no tap is waiting for it any more.
    clip.addEventListener("canplaythrough", () => finish(true), { once: true });
    clip.addEventListener("playing", () => finish(true), { once: true });
    clip.addEventListener("error", () => finish(false), { once: true });
    return clip;
  }

  /** Play `text`'s clip. Call it inside the tap itself, which phones insist on. */
  function play(text: string): Attempt {
    const saved = ready.get(text);
    if (saved) {
      keep(text, saved);
      saved.currentTime = 0;
      const result = saved.play().then(
        (): Outcome => "played",
        (): Outcome => {
          ready.delete(text);
          return "failed";
        },
      );
      return { waiting: false, result, stop() {} };
    }

    const clip = fetchOnce(text);
    let settle: (outcome: Outcome) => void = () => {};
    const result = new Promise<Outcome>((resolve) => {
      let settled = false;
      settle = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clip.removeEventListener("playing", onPlaying);
        clip.removeEventListener("error", onError);
        // A clip that turns up late must not speak over whatever came next.
        if (outcome !== "played") clip.pause();
        resolve(outcome);
      };
    });
    const onPlaying = () => settle("played");
    const onError = () => settle("failed");
    clip.addEventListener("playing", onPlaying);
    clip.addEventListener("error", onError);
    const timer = setTimeout(() => settle("failed"), waitMs);
    clip.play().catch(() => settle("failed"));
    return { waiting: true, result, stop: () => settle("stopped") };
  }

  return { play };
}
