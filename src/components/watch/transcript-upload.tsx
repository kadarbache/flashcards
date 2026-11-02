"use client";

import { useState } from "react";

import { uploadTranscript } from "@/app/watch/actions";
import { field, secondaryButton } from "@/components/ui";
import type { TranscriptView } from "@/lib/transcripts-db";

/**
 * The last way in when no captions can be fetched: upload a subtitle file
 * (.srt or .vtt) or paste the text. Timed files follow the video like YouTube's
 * captions do; plain text is still clickable, just not timed.
 */
export function TranscriptUpload({
  videoId,
  onSaved,
}: {
  videoId: string;
  onSaved: (transcript: TranscriptView) => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(content: string) {
    if (saving || content.trim() === "") return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await uploadTranscript(videoId, content);
      if (outcome.ok) {
        setText("");
        onSaved(outcome.transcript);
      } else {
        setError(outcome.message);
      }
    } catch {
      setError("That could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className={`${secondaryButton} w-full cursor-pointer`}>
        <input
          type="file"
          accept=".srt,.vtt,.txt,text/plain,text/vtt"
          className="sr-only"
          disabled={saving}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) await save(await file.text());
          }}
        />
        {saving ? "Saving…" : "Upload a subtitle file (.srt, .vtt)"}
      </label>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save(text);
        }}
      >
        <textarea
          aria-label="Paste a transcript"
          className={`${field} min-h-24 text-sm`}
          placeholder="…or paste the transcript here"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
        />
        <button type="submit" className={`${secondaryButton} w-full`} disabled={saving || text.trim() === ""}>
          Use this transcript
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm font-bold text-again">
          {error}
        </p>
      )}
    </div>
  );
}
