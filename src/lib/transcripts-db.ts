import { connectToDatabase } from "@/lib/db/connect";
import { Card, Transcript } from "@/lib/db/models";
import { linesFromSegments, normalizeWord, parseSubtitleFile, type TranscriptLine } from "@/lib/transcript";
import {
  fetchFromSupadata,
  fetchFromYouTube,
  fetchVideoTitle,
  type FetchLike,
  type SourceFailure,
  type SourceResult,
} from "@/lib/transcript-sources";

export type TranscriptSource = "youtube" | "supadata" | "upload";

/** A transcript as the watch screen shows it. */
export interface TranscriptView {
  videoId: string;
  lang: string;
  languageName: string;
  auto: boolean;
  title: string;
  source: TranscriptSource;
  timed: boolean;
  lines: TranscriptLine[];
}

export type TranscriptOutcome =
  { ok: true; transcript: TranscriptView } | { ok: false; reason: SourceFailure; title: string };

export interface TranscriptOptions {
  fetchImpl?: FetchLike;
  /** Defaults to SUPADATA_API_KEY. Null turns the paid source off. */
  supadataKey?: string | null;
}

/** What an uploaded transcript is stored under, beside YouTube's copy of the same video. */
export const CUSTOM_LANG = "custom";

/** Enough for a three-hour video. Past this a paste is almost certainly a mistake. */
const MAX_LINES = 6000;
/** Just under the 1 MB a Server Action accepts. */
export const MAX_UPLOAD_CHARS = 900_000;

type StoredTranscript = {
  videoId: string;
  lang: string;
  languageName?: string | null;
  auto?: boolean | null;
  title?: string | null;
  source: string;
  timed?: boolean | null;
  lines?: Array<{ start: number; text: string }> | null;
};

function toView(row: StoredTranscript): TranscriptView {
  return {
    videoId: row.videoId,
    lang: row.lang,
    languageName: row.languageName ?? "",
    auto: Boolean(row.auto),
    title: row.title ?? "",
    source: row.source as TranscriptSource,
    timed: row.timed !== false,
    lines: (row.lines ?? []).map((line) => ({ start: line.start, text: line.text })),
  };
}

/** Save a row, or keep the one another request saved first. Either way, read it back. */
async function store(row: StoredTranscript): Promise<TranscriptView> {
  const { videoId, lang, ...rest } = row;
  try {
    await Transcript.updateOne(
      { videoId, lang },
      { $set: rest, $setOnInsert: { videoId, lang } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  const saved = await Transcript.findOne({ videoId, lang }).lean();
  return toView(saved ?? row);
}

/**
 * Try the free source, then the paid one.
 *
 * The paid source is skipped when YouTube said plainly that the video has no
 * captions -- asking again elsewhere would only spend a request.
 */
async function fetchCaptions(
  videoId: string,
  fetchImpl: FetchLike,
  supadataKey: string | null,
): Promise<{ result: SourceResult; source: TranscriptSource }> {
  const free = await fetchFromYouTube(videoId, fetchImpl);
  if (free.ok || free.reason === "no-captions" || !supadataKey) {
    return { result: free, source: "youtube" };
  }
  const paid = await fetchFromSupadata(videoId, supadataKey, fetchImpl);
  // When both fail, YouTube's reason says more about what went wrong.
  return paid.ok ? { result: paid, source: "supadata" } : { result: free, source: "youtube" };
}

/**
 * A video's transcript: the saved copy if there is one, otherwise fetched and
 * saved. A video has at most two copies, YouTube's and an upload; the most
 * recently used wins, which is how an upload keeps showing once it has
 * replaced YouTube's.
 */
export async function getTranscript(
  videoId: string,
  options: TranscriptOptions = {},
): Promise<TranscriptOutcome> {
  await connectToDatabase();

  const cached = await Transcript.findOne({ videoId }).sort({ updatedAt: -1 }).lean();
  if (cached) {
    await Transcript.updateOne(
      { _id: cached._id },
      { $currentDate: { updatedAt: true } },
      { timestamps: false },
    );
    return { ok: true, transcript: toView(cached) };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const supadataKey =
    options.supadataKey !== undefined ? options.supadataKey : process.env.SUPADATA_API_KEY || null;
  const { result, source } = await fetchCaptions(videoId, fetchImpl, supadataKey);

  if (!result.ok) {
    return { ok: false, reason: result.reason, title: await fetchVideoTitle(videoId, fetchImpl) };
  }

  const lines = linesFromSegments(result.segments).slice(0, MAX_LINES);
  if (lines.length === 0) {
    return { ok: false, reason: "no-captions", title: result.title };
  }

  const transcript = await store({
    videoId,
    lang: result.track.lang,
    languageName: result.track.name,
    auto: result.track.auto,
    title: result.title || (await fetchVideoTitle(videoId, fetchImpl)),
    source,
    timed: true,
    lines,
  });
  return { ok: true, transcript };
}

export type UploadOutcome = { ok: true; transcript: TranscriptView } | { ok: false; message: string };

/**
 * Save a transcript someone pasted or uploaded for a video -- SRT, WebVTT or
 * plain text. It replaces any earlier upload for the same video and is shown
 * from then on in place of YouTube's captions.
 */
export async function saveUploadedTranscript(
  videoId: string,
  raw: string,
  options: { fetchImpl?: FetchLike } = {},
): Promise<UploadOutcome> {
  if (raw.length > MAX_UPLOAD_CHARS) {
    return { ok: false, message: "That file is too big. Subtitles for a long video are well under 1 MB." };
  }
  const { lines, timed } = parseSubtitleFile(raw);
  if (lines.length === 0) {
    return { ok: false, message: "There was no text in that." };
  }

  await connectToDatabase();
  const other = await Transcript.findOne({ videoId, lang: { $ne: CUSTOM_LANG } })
    .select({ title: 1 })
    .lean();

  const transcript = await store({
    videoId,
    lang: CUSTOM_LANG,
    languageName: "Your transcript",
    auto: false,
    title: other?.title || (await fetchVideoTitle(videoId, options.fetchImpl)),
    source: "upload",
    timed,
    lines: lines.slice(0, MAX_LINES),
  });
  return { ok: true, transcript };
}

export interface RecentVideo {
  videoId: string;
  title: string;
}

/** Videos opened lately, newest first, one entry per video. */
export async function listRecentVideos(limit = 8): Promise<RecentVideo[]> {
  await connectToDatabase();
  const rows = await Transcript.find()
    .sort({ updatedAt: -1 })
    .limit(limit * 4)
    .select({ videoId: 1, title: 1 })
    .lean();

  const seen = new Set<string>();
  const recent: RecentVideo[] = [];
  for (const row of rows) {
    if (seen.has(row.videoId)) continue;
    seen.add(row.videoId);
    recent.push({ videoId: row.videoId, title: row.title ?? "" });
    if (recent.length === limit) break;
  }
  return recent;
}

/** Every card front in every deck, as the transcript compares words: lowercased. */
export async function listKnownWords(): Promise<string[]> {
  await connectToDatabase();
  const fronts = (await Card.distinct("front")) as string[];
  return [...new Set(fronts.map(normalizeWord).filter(Boolean))];
}
