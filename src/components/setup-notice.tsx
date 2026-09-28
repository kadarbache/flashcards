/**
 * Shown when the app cannot reach MongoDB. A missing or wrong connection
 * string is the one failure a fresh clone hits first, so it gets a real screen
 * rather than an error overlay.
 */
export function SetupNotice({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Connect a database</h1>
        <p className="mt-1 text-sm text-ink-muted">
          The app could not reach MongoDB.
        </p>
      </div>

      <pre className="overflow-x-auto rounded-lg border border-again/40 bg-surface-raised p-3 text-xs text-again">
        {message}
      </pre>

      <ol className="space-y-2 text-sm text-ink-muted">
        <li>
          1. Create a free cluster at{" "}
          <span className="text-ink">cloud.mongodb.com</span>, then open{" "}
          <span className="text-ink">Connect &rarr; Drivers</span> and copy the
          connection string.
        </li>
        <li>
          2. Copy <code className="text-ink">.env.example</code> to{" "}
          <code className="text-ink">.env.local</code> and paste it as{" "}
          <code className="text-ink">MONGODB_URI</code>, with your real password in
          place of <code className="text-ink">&lt;password&gt;</code>.
        </li>
        <li>
          3. In Atlas, under <span className="text-ink">Network Access</span>, add your
          current IP address to the allow list.
        </li>
        <li>4. Restart the dev server.</li>
      </ol>
    </div>
  );
}
