/** Shown while the transcript is fetched, which can take a second or two the first time. */
export default function WatchLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the video">
      <div className="h-8 w-2/3 max-w-md animate-pulse rounded-full bg-surface-raised" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="aspect-video animate-pulse rounded-3xl bg-surface-raised" />
        <div className="space-y-3 rounded-3xl bg-surface-raised p-5">
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
