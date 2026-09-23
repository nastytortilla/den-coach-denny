"use client";

import { useState } from "react";
import Image from "next/image";
import DenShell from "../components/DenShell";

const quickPrompts = [
  ["Customer question", "Help me answer this customer question: "],
  ["Product information", "Explain this Den Defenders product: "],
  ["Financing help", "Help me explain this financing option: "],
  ["Company policy", "What is our policy for: "],
] as const;

const recent = [
  ["Price objection", "Customer says it costs too much"],
  ["Product comparison", "Centurion vs. Artisan"],
  ["Warranty details", "What does the warranty cover?"],
  ["Appointment help", "How should I explain the next steps?"],
];

export default function CoachPage() {
  const [input, setInput] = useState("Customer says it's too expensive");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Request failed";
  }

  async function askCoach() {
    if (!input.trim() || loading) return;
    try {
      setLoading(true);
      setStatus("Coach Denny is thinking...");
      setOutput("");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const text = await res.text();
      let data: { reply?: string; error?: string; details?: string } = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "Server returned non-JSON", details: text }; }
      if (!res.ok) {
        setStatus(`Error: ${data.error || "Request failed"}\n${data.details || ""}`);
        return;
      }
      setStatus("");
      setOutput(data.reply || "");
    } catch (error: unknown) {
      setStatus(`Error: ${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <DenShell title="Chat with Coach Denny" subtitle="Fast answers for every customer" theme="chat">
      <div className="chat-layout">
        <aside className="chat-sidebar surface">
          <h2>Recent Conversations</h2>
          <button className="btn btn-teal" type="button" onClick={() => { setInput(""); setOutput(""); setStatus(""); }}>+ New Conversation</button>
          <div className="recent-list">
            {recent.map(([title, copy]) => <div className="recent-item" key={title}><strong>{title}</strong><span>{copy}</span></div>)}
          </div>
        </aside>

        <section className="chat-workspace surface">
          <h1 className="display-title">Chat with Coach Denny</h1>
          <p className="page-subtitle">Fast answers for every customer.</p>
          <div className="quick-prompts">
            {quickPrompts.map(([label, prompt]) => <button key={label} className="quick-prompt" type="button" onClick={() => setInput(prompt)}>{label} <span aria-hidden="true">→</span></button>)}
          </div>

          {output ? (
            <div className="chat-response"><h3>Coach Denny</h3><pre>{output}</pre></div>
          ) : (
            <div className="chat-response"><h3>What can I help you with today?</h3><p>Ask about a customer objection, product, financing option, or company policy.</p></div>
          )}

          {status && <div className="notice">{status}</div>}
          <div className="chat-composer">
            <textarea
              className="chat-input"
              value={input}
              placeholder="Ask Coach Denny anything…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void askCoach();
                }
              }}
            />
            <button className="btn btn-teal" onClick={askCoach} disabled={loading || !input.trim()}>{loading ? "Thinking…" : "Send"} <span aria-hidden="true">→</span></button>
          </div>
          <div className="input-hint">Press Enter to submit. Use Shift+Enter for a new line.</div>
        </section>

        <aside className="chat-aside surface">
          <Image className="aside-mascot" src="/brand/denny.png" alt="Coach Denny" width={500} height={500} />
          <div className="tip-card"><h2>Denny’s Tip</h2><p>Include the customer’s exact words and what you want to accomplish. The more context you give me, the more useful my answer will be.</p></div>
        </aside>
      </div>
    </DenShell>
  );
}
