import { parseTimedTextXml, pickTrack, type CaptionSegment, type CaptionTrack } from "@/lib/transcript";

/**
 * Where transcripts come from. Each source either returns captions or says why
 * it could not, and the caller decides what to try next.
 *
 * `fetchImpl` is injected so tests can stand in for YouTube.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Why a source came back empty.
 *
 * - `no-captions`: the video has no captions at all. Trying elsewhere will not help.
 * - `blocked`: YouTube refused this server (it blocks most cloud addresses).
 * - `unavailable`: the video is private, removed, or not playable here.
 * - `failed`: anything else -- a network error, or a response shape that changed.
 */
export type SourceFailure = "no-captions" | "blocked" | "unavailable" | "failed";

export interface SourceCaptions {
  ok: true;
  title: string;
  track: CaptionTrack;
  segments: CaptionSegment[];
}

export type SourceResult = SourceCaptions | { ok: false; reason: SourceFailure };

/** What YouTube's own Android app sends. The web client's caption links need a token this cannot make. */
const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38" } as const;

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{
        baseUrl?: string;
        languageCode?: string;
        kind?: string;
        name?: { simpleText?: string; runs?: Array<{ text?: string }> };
      }>;
    };
  };
};

function trackName(name: { simpleText?: string; runs?: Array<{ text?: string }> } | undefined): string {
  return name?.simpleText ?? name?.runs?.map((run) => run.text ?? "").join("") ?? "";
}

/**
 * Captions straight from YouTube, free and with no key: the same request the
 * YouTube app makes for a video's details, then the caption file it links to.
 *
 * This is not a documented API. It works from a home connection; from a cloud
 * server YouTube often answers with a "confirm you're not a bot" refusal, which
 * comes back as `blocked` so the caller can try the paid source instead.
 *
 * One track is taken per video: English if there is one, otherwise the best
 * of what the video has.
 */
export async function fetchFromYouTube(videoId: string, fetchImpl: FetchLike = fetch): Promise<SourceResult> {
  let player: PlayerResponse;
  try {
    const response = await fetchImpl("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "en-US,en;q=0.9" },
      body: JSON.stringify({ context: { client: { ...ANDROID_CLIENT, hl: "en" } }, videoId }),
    });
    if (response.status === 429 || response.status === 403) return { ok: false, reason: "blocked" };
    if (!response.ok) return { ok: false, reason: "failed" };
    player = (await response.json()) as PlayerResponse;
  } catch {
    return { ok: false, reason: "failed" };
  }

  const status = player.playabilityStatus?.status;
  const raw = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (raw.length === 0) {
    if (status === "LOGIN_REQUIRED" && /bot/i.test(player.playabilityStatus?.reason ?? "")) {
      return { ok: false, reason: "blocked" };
    }
    if (status && status !== "OK") return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "no-captions" };
  }

  const tracks = raw
    .filter((track) => track.baseUrl && track.languageCode)
    .map((track) => ({
      lang: track.languageCode as string,
      name: trackName(track.name) || (track.languageCode as string),
      auto: track.kind === "asr",
      url: track.baseUrl as string,
    }));
  const chosen = pickTrack(tracks);
  if (!chosen) return { ok: false, reason: "no-captions" };

  // Without `fmt` the file is the simple XML of <text start dur> lines.
  const url = new URL(chosen.url, "https://www.youtube.com");
  url.searchParams.delete("fmt");

  let xml: string;
  try {
    const response = await fetchImpl(url.toString(), { headers: { "accept-language": "en-US,en;q=0.9" } });
    if (response.status === 429 || response.status === 403) return { ok: false, reason: "blocked" };
    if (!response.ok) return { ok: false, reason: "failed" };
    xml = await response.text();
  } catch {
    return { ok: false, reason: "failed" };
  }

  const segments = parseTimedTextXml(xml);
  // An empty file with a 200 is how YouTube says no when it wants a token.
  if (segments.length === 0) return { ok: false, reason: "blocked" };

  return {
    ok: true,
    title: player.videoDetails?.title ?? "",
    track: { lang: chosen.lang, name: chosen.name, auto: chosen.auto },
    segments,
  };
}

type SupadataChunk = { text?: string; offset?: number; duration?: number; lang?: string };
type SupadataBody = {
  content?: SupadataChunk[] | string;
  lang?: string;
  jobId?: string;
  status?: string;
  error?: string;
};

const SUPADATA = "https://api.supadata.ai/v1/transcript";
const JOB_POLLS = 10;
const JOB_POLL_MS = 1500;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Captions from Supadata, a paid service that fetches them on our behalf and
 * deals with YouTube's blocking. Only used when `SUPADATA_API_KEY` is set.
 *
 * `mode=native` asks for the captions the video already has, never a
 * machine-made transcript of the audio, which costs more and is the job of the
 * upload box. A long video can come back as a job to poll. English is asked
 * for; a video without it comes back in its first language.
 */
export async function fetchFromSupadata(
  videoId: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<SourceResult> {
  const query = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    mode: "native",
    lang: "en",
  });
  const headers = { "x-api-key": apiKey };

  let body: SupadataBody;
  try {
    const response = await fetchImpl(`${SUPADATA}?${query}`, { headers });
    if (response.status === 206 || response.status === 404) return { ok: false, reason: "no-captions" };
    if (!response.ok) return { ok: false, reason: "failed" };
    body = (await response.json()) as SupadataBody;

    const jobId = response.status === 202 ? body.jobId : undefined;
    for (let poll = 0; jobId && poll < JOB_POLLS; poll += 1) {
      await wait(JOB_POLL_MS);
      const jobResponse = await fetchImpl(`${SUPADATA}/${encodeURIComponent(jobId)}`, { headers });
      if (!jobResponse.ok) return { ok: false, reason: "failed" };
      const job = (await jobResponse.json()) as SupadataBody;
      if (job.status === "failed") return { ok: false, reason: "no-captions" };
      if (job.status === "completed" || Array.isArray(job.content)) {
        body = job;
        break;
      }
    }
  } catch {
    return { ok: false, reason: "failed" };
  }

  if (!Array.isArray(body.content) || body.content.length === 0) {
    return { ok: false, reason: body.error === "transcript-unavailable" ? "no-captions" : "failed" };
  }

  const code = body.lang ?? "en";
  return {
    ok: true,
    title: "",
    track: { lang: code, name: languageName(code), auto: false },
    segments: body.content.map((chunk) => ({
      start: (chunk.offset ?? 0) / 1000,
      duration: (chunk.duration ?? 0) / 1000,
      text: chunk.text ?? "",
    })),
  };
}

/** The video's title from YouTube's oEmbed endpoint, which needs no key. Empty when it fails. */
export async function fetchVideoTitle(videoId: string, fetchImpl: FetchLike = fetch): Promise<string> {
  try {
    const response = await fetchImpl(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    );
    if (!response.ok) return "";
    const data = (await response.json()) as { title?: string };
    return typeof data.title === "string" ? data.title : "";
  } catch {
    return "";
  }
}
