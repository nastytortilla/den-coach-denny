"use client";

import { useState } from "react";
import DenShell from "../components/DenShell";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function SchedulePage() {
  const [input, setInput] = useState(
    "Find the earliest three sales appointment options for 7953 Kyle Ct, Citrus Heights, CA."
  );

  const [conversation, setConversation] =
    useState<ConversationMessage[]>([]);

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function askDenny() {
    const trimmedInput = input.trim();

    if (!trimmedInput || loading) {
      return;
    }

    const userMessage: ConversationMessage = {
      role: "user",
      content: trimmedInput,
    };

    const nextConversation = [
      ...conversation,
      userMessage,
    ];

    setConversation(nextConversation);
    setInput("");
    setStatus("Checking ServiceTitan and routes...");
    setLoading(true);

    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextConversation,
        }),
      });

      const text = await res.text();

      let data: any = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {
          error: "Server returned non-JSON",
          details: text,
        };
      }

      if (!res.ok) {
        setStatus(
          `Error: ${data.error || "Request failed"}\n${
            data.details || ""
          }`
        );
        return;
      }

      const assistantMessage: ConversationMessage = {
        role: "assistant",
        content:
          data.reply || "No reply returned.",
      };

      setConversation([
        ...nextConversation,
        assistantMessage,
      ]);

      setStatus("");
    } catch (error: any) {
      setStatus(
        `Error: ${
          error?.message || "Request failed"
        }`
      );
    } finally {
      setLoading(false);
    }
  }

  function startNewSearch() {
    setConversation([]);
    setInput("");
    setStatus("");
    setLoading(false);
  }

  return (
    <DenShell
      title="Denny’s Smart Scheduler"
      subtitle="Find the best sales consultant, date, and time"
    >
      <p style={{ marginTop: 0, fontWeight: 800 }}>
        {conversation.length === 0
          ? "Describe the customer and requested appointment:"
          : "Ask Denny a follow-up question:"}
      </p>

      <textarea
        className="den-textarea"
        value={input}
        placeholder={
          conversation.length === 0
            ? "Enter the customer address and any requested date or time."
            : 'Try: "Why?" or "The customer needs three more options."'
        }
        onChange={(event) =>
          setInput(event.target.value)
        }
      />

      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={askDenny}
          className="den-link"
          disabled={loading || !input.trim()}
        >
          {loading
            ? "Checking..."
            : conversation.length === 0
              ? "Find Best Appointments"
              : "Ask Denny"}
        </button>

        {conversation.length > 0 && (
          <button
            onClick={startNewSearch}
            className="den-link"
            disabled={loading}
          >
            Start New Search
          </button>
        )}
      </div>

      {status && (
        <pre
          style={{
            marginTop: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {status}
        </pre>
      )}

      {conversation.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3>Scheduling Conversation</h3>

          {conversation.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop:
                  index === 0
                    ? "none"
                    : "1px solid rgba(0, 0, 0, 0.15)",
              }}
            >
              <strong>
                {message.role === "user"
                  ? "CSR"
                  : "Denny"}
              </strong>

              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {message.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </DenShell>
  );
}