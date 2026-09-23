"use client";

import { useState } from "react";
import Image from "next/image";
import { upload } from "@vercel/blob/client";
import DenShell from "../components/DenShell";
import TalkToCoachDenny from "../components/TalkToCoachDenny";

export default function ScorePage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [csrQuestion, setCsrQuestion] = useState("");
  const [followupStatus, setFollowupStatus] = useState("");
  const [followupAnswer, setFollowupAnswer] = useState("");
  const [followupLoading, setFollowupLoading] = useState(false);

  function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }

  async function uploadAndScore() {
    if (!file) { setStatus("Choose an audio file first."); return; }
    setLoading(true); setStatus("Uploading audio..."); setTranscript(""); setFeedback("");
    setCsrQuestion(""); setFollowupStatus(""); setFollowupAnswer("");
    try {
      const blob = await upload(file.name, file, { access: "public", handleUploadUrl: "/api/blob/upload" });
      if (!blob?.url) { setStatus("Upload failed: no blob URL returned."); return; }
      setStatus("Transcribing and preparing coaching feedback...");
      const response = await fetch("/api/score-call", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "score", blobUrl: blob.url, callType: "Unknown", goal: "Unknown" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) { setStatus("Score failed: " + (data?.error || `HTTP ${response.status}`)); return; }
      setTranscript(data?.transcript ?? ""); setFeedback(data?.feedback ?? ""); setStatus("Analysis complete.");
    } catch (error: unknown) { setStatus("Error: " + getErrorMessage(error)); }
    finally { setLoading(false); }
  }

  async function askFollowup() {
    if (!transcript || !feedback) { setFollowupStatus("Run a score first so I have context."); return; }
    if (!csrQuestion.trim()) { setFollowupStatus("Type a question first."); return; }
    setFollowupLoading(true); setFollowupStatus("Sending question to Coach Denny..."); setFollowupAnswer("");
    try {
      const response = await fetch("/api/score-call", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "followup", csrQuestion: csrQuestion.trim(), transcript, scoreOutput: feedback }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) { setFollowupStatus("Follow-up failed: " + (data?.error || `HTTP ${response.status}`)); return; }
      setFollowupAnswer(data?.answer ?? ""); setFollowupStatus("");
    } catch (error: unknown) { setFollowupStatus("Error: " + getErrorMessage(error)); }
    finally { setFollowupLoading(false); }
  }

  return (
    <DenShell title="Let Coach Denny Listen" subtitle="Turn calls into coaching insights" theme="listen">
      <section className="listen-hero">
        <div>
          <p className="eyebrow">Call review & coaching</p>
          <h1 className="display-title">Turn every call into <span>a coaching moment.</span></h1>
          <p>Upload a customer call and Denny will highlight what worked—and what to improve.</p>
        </div>
        <Image className="listen-mascot" src="/brand/denny.png" alt="Coach Denny" width={500} height={500} priority />
      </section>

      <section className="upload-panel surface">
        <div className="file-status">
          <span className="play-disc" aria-hidden="true">▶</span>
          <div><strong>{file ? file.name : "Choose a customer call"}</strong><span>{file ? "Ready for Coach Denny" : "Audio files supported"}</span></div>
        </div>
        <div className="listen-actions">
          <input id="audioFile" type="file" accept="audio/*" hidden onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <label htmlFor="audioFile" className="btn btn-teal">Choose Call</label>
          <button className="btn btn-coral" disabled={loading || !file} onClick={uploadAndScore}>{loading ? "Working…" : "Upload + Get Feedback"}</button>
        </div>
      </section>

      {status && <div className="notice" style={{ marginTop: 12 }}>{status}</div>}

      <section className="insight-grid">
        <article className="insight-card surface">
          <h2>✓ What Went Well</h2>
          <p>{feedback ? "Your complete coaching feedback is ready below." : "Denny will identify strong greetings, discovery questions, explanations, and next steps."}</p>
        </article>
        <article className="insight-card surface">
          <h2>◆ Coaching Opportunities</h2>
          <p>{feedback ? "Review the specific opportunities and recommended language below." : "Upload a call to uncover focused, practical ways to make the next conversation stronger."}</p>
        </article>

        {(transcript || feedback) && (
          <article className="insight-card surface result-section">
            {transcript && <><h2>Call Transcript</h2><div className="result-box"><pre className="output-pre">{transcript}</pre></div></>}
            {feedback && <><h2 style={{ marginTop: 24 }}>Coaching Feedback</h2><div className="result-box"><pre className="output-pre">{feedback}</pre></div></>}

            {feedback && <div className="followup-area">
              <h2>Ask Coach Denny</h2>
              <p>Ask a follow-up question about this call and Denny will use the transcript and feedback as context.</p>
              <textarea className="chat-input" value={csrQuestion} onChange={(event) => setCsrQuestion(event.target.value)} placeholder="Example: How should I have handled the price moment without losing control?" />
              <div><button className="btn btn-amber" disabled={followupLoading} onClick={askFollowup}>{followupLoading ? "Asking…" : "Ask Coach Denny"}</button></div>
              {followupStatus && <div className="notice">{followupStatus}</div>}
              {followupAnswer && <div className="result-box"><pre className="output-pre">{followupAnswer}</pre></div>}
              <TalkToCoachDenny transcript={transcript} scoreOutput={feedback} />
            </div>}
          </article>
        )}
      </section>
    </DenShell>
  );
}
