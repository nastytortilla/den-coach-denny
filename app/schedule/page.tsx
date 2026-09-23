"use client";

import { useState } from "react";
import DenShell from "../components/DenShell";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const DEFAULT_SEARCH =
  "Find the earliest three sales appointment options for a customer in [ZIP code, city, or address].";

const NEXT_OPTIONS_MESSAGE = "Next 3 Options";

export default function SchedulePage() {
  const [input, setInput] = useState(DEFAULT_SEARCH);
  const [conversation, setConversation] =
    useState<ConversationMessage[]>([]);
  const [consultantChoices, setConsultantChoices] =
    useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const hasAssistantReply = conversation.some(
    (message) => message.role === "assistant"
  );

  async function submitMessage(messageText: string) {
    const trimmedInput = messageText.trim();

    if (!trimmedInput || loading) {
      return;
    }

    const userMessage: ConversationMessage = {
      role: "user",
      content: trimmedInput,
    };
    const nextConversation = [...conversation, userMessage];

    setConversation(nextConversation);
    setInput("");
    setConsultantChoices([]);
    setStatus("Checking sales schedules and routes...");
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
        content: data.reply || "No reply returned.",
      };

      const returnedConsultantChoices = Array.isArray(
        data.consultantChoices
      )
        ? data.consultantChoices
            .map((choice: unknown) =>
              String(choice || "").trim()
            )
            .filter(Boolean)
        : [];

      setConversation([
        ...nextConversation,
        assistantMessage,
      ]);

      setConsultantChoices(
        returnedConsultantChoices
      );

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

  async function askDenny() {
    await submitMessage(input);
  }

  async function nextThreeOptions() {
    if (!hasAssistantReply || loading) {
      return;
    }

    await submitMessage(NEXT_OPTIONS_MESSAGE);
  }

  async function chooseConsultant(
    consultantName: string
  ) {
    await submitMessage(
      `Use ${consultantName} for this location.`
    );
  }

  function startNewSearch() {
    setConversation([]);
    setInput(DEFAULT_SEARCH);
    setConsultantChoices([]);
    setStatus("");
    setLoading(false);
  }

  return (
    <DenShell
      title="Denny’s Smart Scheduler"
      subtitle="Find the best sales consultant, date, and time"
    >
      {conversation.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>
            Scheduling Conversation
          </h3>
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

      {consultantChoices.length > 0 && (
        <div
          style={{
            marginBottom: 20,
            padding: 14,
            border: "1px solid rgba(0, 0, 0, 0.18)",
            borderRadius: 12,
          }}
        >
          <p
            style={{
              marginTop: 0,
              marginBottom: 10,
              fontWeight: 800,
            }}
          >
            Choose the sales consultant:
          </p>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {consultantChoices.map(
              (consultantName) => (
                <button
                  key={consultantName}
                  onClick={() =>
                    chooseConsultant(
                      consultantName
                    )
                  }
                  className="den-link"
                  disabled={loading}
                >
                  {consultantName}
                </button>
              )
            )}
          </div>
        </div>
      )}

      <p style={{ marginTop: 0, fontWeight: 800 }}>
        {conversation.length === 0
          ? "Enter the customer’s ZIP code, city, or address:"
          : "Ask Denny a follow-up question:"}
      </p>
      <textarea
        className="den-textarea"
        value={input}
        placeholder={
          conversation.length === 0
            ? "Find the earliest three sales appointment options for a customer in [ZIP code, city, or address]."
            : 'Try: "Why?" or click "Next 3 Options" if the customer needs more choices.'
        }
        onChange={(event) =>
          setInput(event.target.value)
        }
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void askDenny();
          }
        }}
        aria-keyshortcuts="Enter"
      />
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          opacity: 0.7,
        }}
      >
        Press Enter to submit. Use Shift+Enter for a new line.
      </div>
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

        {hasAssistantReply &&
          consultantChoices.length === 0 && (
            <button
              onClick={nextThreeOptions}
              className="den-link"
              disabled={loading}
            >
              Next 3 Options
            </button>
          )}

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
            overflowWrap: "anywhere",
          }}
        >
          {status}
        </pre>
      )}
    </DenShell>
  );
}
