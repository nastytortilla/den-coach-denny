"use client";

import { useState } from "react";
import DenShell from "../components/DenShell";

export default function SchedulePage() {
  const [input, setInput] = useState(
    "Find the best three sales appointment options for a customer in Citrus Heights, CA."
  );
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("");

  async function findAppointments() {
    try {
      setStatus("Checking ServiceTitan...");
      setOutput("");

      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
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

      setStatus("");
      setOutput(data.reply || "");
    } catch (error: any) {
      setStatus(
        `Error: ${error?.message || "Request failed"}`
      );
    }
  }

  return (
    <DenShell
      title="Denny’s Smart Scheduler"
      subtitle="Find the best sales consultant, date, and time"
    >
      <p style={{ marginTop: 0, fontWeight: 800 }}>
        Describe the customer and requested appointment:
      </p>

      <textarea
        className="den-textarea"
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />

      <div style={{ marginTop: 12 }}>
        <button
          onClick={findAppointments}
          className="den-link"
        >
          Find Best Appointment
        </button>
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

      {output && (
        <>
          <h3 style={{ marginTop: 18 }}>
            Scheduling Recommendation
          </h3>

          <pre style={{ whiteSpace: "pre-wrap" }}>
            {output}
          </pre>
        </>
      )}
    </DenShell>
  );
}