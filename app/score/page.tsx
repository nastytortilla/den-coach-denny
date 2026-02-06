"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
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
      // 1) DIRECT upload from browser -> Vercel Blob
      // (This avoids HTTP 413 because the big file does NOT go through your server function.)
      setStatus("Uploading audio...");
      const blob = await upload(file.name, file, {
        access: "public", // easiest; "private" is doable but requires signed reads
        handleUploadUrl: "/api/blob/upload",
      });

      const blobUrl = blob?.url;
      if (!blobUrl) {
        setStatus("Upload failed: no blob URL returned.");
        return;
      }

      // 2) Score using ONLY the blobUrl (tiny payload)
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
        setStatus(
          "Score failed: " + (scoreData?.error || `HTTP ${scoreRes.status}`)
        );
        return;
      }

      setTranscript(scoreData?.transcript ?? "");
      setFeedback(scoreData?.feedback ?? "");
      setStatus("Done!");
    } catch (err: any) {
      setStatus("Error: " + (err?.message || String(err)));
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
