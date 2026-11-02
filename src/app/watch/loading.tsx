import { transcriptPanel, transcriptSlot, videoFrame, watchGrid } from "@/components/watch/layout";

/** Shown while the transcript is fetched, which can take a second or two the first time. */
export default function WatchLoading() {
  return (
    <div data-wide className={watchGrid} aria-busy="true" aria-label="Loading the video">
      <div className={`${videoFrame} animate-pulse bg-surface-raised`} />
      <div className="h-8 w-2/3 max-w-md animate-pulse rounded-full bg-surface-raised xl:col-start-1 xl:row-start-2" />
      <div className={transcriptSlot}>
        <div className={`${transcriptPanel} p-5`}>
          <p className="text-sm font-bold text-ink-muted">Fetching the transcript…</p>
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded-full bg-surface-high"
              style={{ width: `${90 - i * 8}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
