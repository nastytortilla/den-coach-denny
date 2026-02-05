"use client";

import { useState } from "react";
import DenShell from "../components/DenShell";


export default function CoachPage() {
  const [input, setInput] = useState("Customer says it's too expensive");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("");

  async function askCoach() {
    try {
      setStatus("Thinking...");
      setOutput("");

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: "Server returned non-JSON", details: text };
      }

      if (!res.ok) {
        setStatus(`Error: ${data.error || "Request failed"}\n${data.details || ""}`);
        return;
      }

      setStatus("");
      setOutput(data.reply || "");
    } catch (e: any) {
      setStatus(`Error: ${e?.message || "Request failed"}`);
    }
  }

  return (
    <DenShell title="Chat With Coach Denny" subtitle="Type the objection and get a coached response">
      <p style={{ marginTop: 0, fontWeight: 800 }}>Type what the customer said:</p>

      <textarea
        className="den-textarea"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />

      <div style={{ marginTop: 12 }}>
        {/* keeps your link-like styling if you already have .linklike, but also works without it */}
        <button onClick={askCoach} className="den-link">
          Ask Coach
        </button>
      </div>

      {status && (
        <pre style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{status}</pre>
      )}

      {output && (
        <>
          <h3 style={{ marginTop: 18 }}>Coach Reply</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{output}</pre>
        </>
      )}
    </DenShell>
  );
}

