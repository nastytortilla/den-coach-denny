"use client";

import { useState } from "react";
import DenShell from "../components/DenShell";
import { upload } from "@vercel/blob/client";

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
    try {
      setStatus("Uploading...");
      setTranscript("");
      setFeedback("");

      // 1) Upload large audio directly to Vercel Blob (bypasses Vercel body size limits)
      let blob;
      try {
        blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          multipart: true, // IMPORTANT for larger files
        });
      } catch (err: any) {
        setStatus("Upload failed: " + (err?.message || String(err)));
        return;
      }

      // 2) Call your scoring API with ONLY the blob URL (not the raw file)
      setStatus("Scoring call...");
      let res: Response;
      try {
        res = await fetch("/api/score-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobUrl: blob.url,
            originalName: file.name,
            mimeType: file.type,
          }),
        });
      } catch {
        setStatus("Network error: could not reach the server.");
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      if (!res.ok) {
        const msg =
          typeof data === "string"
            ? data
            : (data as any)?.error ||
              (data as any)?.details ||
              `HTTP ${res.status}`;
        setStatus("Error: " + msg);
        return;
      }

      setTranscript((data as any)?.transcript ?? "");
      setFeedback((data as any)?.feedback ?? "");
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
      {/* Hidden real file input */}
      <input
        id="audioFile"
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      {/* Styled “link button” label */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
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
          {loading ? "Uploading..." : "Upload + Get Feedback"}
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
