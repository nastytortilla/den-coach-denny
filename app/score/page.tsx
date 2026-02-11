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

  // Post-score Q&A
  const [csrQuestion, setCsrQuestion] = useState("");
  const [followupStatus, setFollowupStatus] = useState("");
  const [followupAnswer, setFollowupAnswer] = useState("");
  const [followupLoading, setFollowupLoading] = useState(false);

  async function uploadAndScore() {
    if (!file) {
      setStatus("Pick an audio file first.");
      return;
    }

    setLoading(true);
    setStatus("");
    setTranscript("");
    setFeedback("");

    // Reset follow-up state
    setCsrQuestion("");
    setFollowupStatus("");
    setFollowupAnswer("");

    try {
      setStatus("Uploading audio...");
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
      });

      const blobUrl = blob?.url;
      if (!blobUrl) {
        setStatus("Upload failed: no blob URL returned.");
        return;
      }

      setStatus("Transcribing + scoring...");
      const scoreRes = await fetch("/api/score-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "score",
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

  async function askFollowup() {
    if (!transcript || !feedback) {
      setFollowupStatus("Run a score first so I have context.");
      return;
    }
    if (!csrQuestion.trim()) {
      setFollowupStatus("Type a question first.");
      return;
    }

    setFollowupLoading(true);
    setFollowupStatus("");
    setFollowupAnswer("");

    try {
      setFollowupStatus("Sending question to Coach Denny...");

      const res = await fetch("/api/score-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "followup",
          csrQuestion: csrQuestion.trim(),
          transcript,
          scoreOutput: feedback,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFollowupStatus(
          "Follow-up failed: " + (data?.error || `HTTP ${res.status}`)
        );
        return;
      }

      setFollowupAnswer(data?.answer ?? "");
      setFollowupStatus("Done!");
    } catch (err: any) {
      setFollowupStatus("Error: " + (err?.message || String(err)));
    } finally {
      setFollowupLoading(false);
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

          <h3 style={{ marginTop: 18 }}></h3>

          <p style={{ marginTop: 6, opacity: 0.85 }}>
            Question about your call? Want to meet in the parking lot? Coach Denny will answer any question you have. 
          </p>

          <textarea
            value={csrQuestion}
            onChange={(e) => setCsrQuestion(e.target.value)}
            placeholder="Example: How should I have handled the price moment without losing control?"
            style={{
              width: "100%",
              minHeight: 90,
              marginTop: 10,
              padding: 10,
              border: "1px solid #000",
              borderRadius: 6,
              fontSize: 14,
            }}
          />

          <div style={{ marginTop: 10 }}>
            <button
              disabled={followupLoading}
              onClick={askFollowup}
              className="den-link"
              style={{
                cursor: followupLoading ? "not-allowed" : "pointer",
                opacity: followupLoading ? 0.7 : 1,
              }}
            >
              {followupLoading ? "Asking..." : "Ask Coach Denny"}
            </button>
          </div>

          {followupStatus && <p style={{ marginTop: 10 }}>{followupStatus}</p>}

          {followupAnswer && (
            <>
              <h3 style={{ marginTop: 14 }}>Coach Denny Answer</h3>
              <pre style={{ whiteSpace: "pre-wrap" }}>{followupAnswer}</pre>
            </>
          )}
        </>
      )}
    </DenShell>
  );
}
