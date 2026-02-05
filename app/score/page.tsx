"use client";

import { useState } from "react";
import DenShell from "../components/DenShell";

export default function ScorePage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);

  async function uploadAndScore() {
    if (!file) {
      setStatus("Pick an audio file first.");
      return;
    }

    setLoading(true);
    setStatus("");
    setTranscript("");
    setFeedback("");

    try {
      // 1) Upload raw file bytes to your Blob upload route
      setStatus("Uploading audio...");
      const uploadRes = await fetch(
        `/api/blob/upload?filename=${encodeURIComponent(file.name)}`,
        {
          method: "POST",
          body: file,
          headers: { "content-type": file.type || "application/octet-stream" },
        }
      );

      const uploadData = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) {
        setStatus("Upload failed: " + (uploadData?.error || `HTTP ${uploadRes.status}`));
        return;
      }

      const blobUrl = uploadData?.url as string | undefined;
      if (!blobUrl) {
        setStatus("Upload failed: no blob URL returned.");
        return;
      }

      // 2) Score using ONLY the blobUrl (no big payload)
      setStatus("Transcribing + scoring...");
      const scoreRes = await fetch("/api/score-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blobUrl,
          callType: "Unknown",
          goal: "Unknown",
        }),
      });

      const scoreData = await scoreRes.json().catch(() => null);
      if (!scoreRes.ok) {
        setStatus("Score failed: " + (scoreData?.error || `HTTP ${scoreRes.status}`));
        return;
      }

      setTranscript(scoreData?.transcript ?? "");
      setFeedback(scoreData?.feedback ?? "");
      setStatus("Done!");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DenShell
      title="Let Coach Denny Listen"
      subtitle="Upload a call and get transcript + coaching feedback"
    >
      <input
        id="audioFile"
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="audioFile" className="den-link" style={{ cursor: "pointer" }}>
          Choose audio file
        </label>

        {file && (
          <span style={{ fontSize: 14, opacity: 0.85 }}>
            Selected: <strong>{file.name}</strong>
          </span>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          disabled={loading}
          onClick={uploadAndScore}
          className="den-link"
          style={{
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Working..." : "Upload + Get Feedback"}
        </button>
      </div>

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      {transcript && (
        <>
          <h3 style={{ marginTop: 18 }}>Transcript</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{transcript}</pre>
        </>
      )}

      {feedback && (
        <>
          <h3 style={{ marginTop: 18 }}>Coaching Feedback</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{feedback}</pre>
        </>
      )}
    </DenShell>
  );
}
