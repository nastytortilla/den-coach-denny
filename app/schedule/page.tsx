"use client";

import { Fragment, useRef, useState } from "react";
import Image from "next/image";
import DenShell from "../components/DenShell";
import salesZipDirectory from "../lib/salesZipDirectory.json";

type ConversationMessage = { role: "user" | "assistant"; content: string };
type ZipDirectory = Record<string, string[]>;
type LocationPreview = {
  city: string;
  state: string;
  zip: string;
  inServiceArea: boolean;
  latitude?: number;
  longitude?: number;
};
const NEXT_OPTIONS_MESSAGE = "Next 3 Options";
const SERVICE_ZIPS = salesZipDirectory as ZipDirectory;

function immediateZipReply(message: string) {
  const zip = message.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  if (!zip) return "";

  const location = SERVICE_ZIPS[zip];
  if (!location) {
    return `${zip} is outside the approved Den Defenders sales service area.`;
  }

  const [city, state] = location;
  return `${zip} is ${city}, ${state}, and it is in our service area.`;
}

function immediateZipPreview(message: string): LocationPreview | null {
  const zip = message.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  if (!zip) return null;
  const location = SERVICE_ZIPS[zip];
  if (!location) {
    return { city: "Location", state: "", zip, inServiceArea: false };
  }
  return {
    city: location[0],
    state: location[1],
    zip,
    inServiceArea: true,
  };
}

export default function SchedulePage() {
  const [input, setInput] = useState("");
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [consultantChoices, setConsultantChoices] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingZipReply, setPendingZipReply] = useState("");
  const [locationPreview, setLocationPreview] = useState<LocationPreview | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const previewRequestId = useRef(0);
  const hasAssistantReply = conversation.some((message) => message.role === "assistant");

  function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Request failed";
  }

  async function loadLocationPreview(location: string, requestId: number) {
    setMapLoading(true);
    try {
      const response = await fetch("/api/location-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location }),
      });
      const data = await response.json().catch(() => ({}));
      if (requestId !== previewRequestId.current || !response.ok) return;
      setLocationPreview({
        city: String(data.city || "Location"),
        state: String(data.state || ""),
        zip: String(data.zip || ""),
        inServiceArea: data.inServiceArea === true,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
      });
    } finally {
      if (requestId === previewRequestId.current) setMapLoading(false);
    }
  }

  async function submitMessage(messageText: string) {
    const trimmedInput = messageText.trim();
    if (!trimmedInput || loading) return;
    const userMessage: ConversationMessage = { role: "user", content: trimmedInput };
    const nextConversation = [...conversation, userMessage];
    const quickReply = conversation.length === 0 ? immediateZipReply(trimmedInput) : "";
    const quickPreview = conversation.length === 0 ? immediateZipPreview(trimmedInput) : null;
    setConversation(nextConversation); setInput(""); setConsultantChoices([]);
    setPendingZipReply(quickReply);
    if (conversation.length === 0) {
      const requestId = previewRequestId.current + 1;
      previewRequestId.current = requestId;
      setLocationPreview(quickPreview);
      void loadLocationPreview(trimmedInput, requestId);
    }
    setStatus(quickReply ? "Finding the three best appointment options..." : "Checking territories, sales schedules, drive times, and routing rules..."); setLoading(true);
    try {
      const response = await fetch("/api/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextConversation, locationPreviewEnabled: true }),
      });
      const text = await response.text();
      let data: { reply?: string; error?: string; details?: string; consultantChoices?: unknown[] } = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: "Server returned non-JSON", details: text }; }
      if (!response.ok) { setStatus(`Error: ${data.error || "Request failed"}\n${data.details || ""}`); return; }
      const assistantMessage: ConversationMessage = { role: "assistant", content: data.reply || "No reply returned." };
      const choices = Array.isArray(data.consultantChoices) ? data.consultantChoices.map((choice: unknown) => String(choice || "").trim()).filter(Boolean) : [];
      setPendingZipReply(""); setConversation([...nextConversation, assistantMessage]); setConsultantChoices(choices); setStatus("");
    } catch (error: unknown) { setStatus(`Error: ${errorMessage(error)}`); }
    finally { setLoading(false); }
  }

  async function askDenny() { await submitMessage(input); }
  async function nextThreeOptions() { if (hasAssistantReply && !loading) await submitMessage(NEXT_OPTIONS_MESSAGE); }
  async function chooseConsultant(name: string) { await submitMessage(`Use ${name} for this location.`); }
  function startNewSearch() {
    previewRequestId.current += 1;
    setConversation([]); setInput(""); setConsultantChoices([]); setPendingZipReply("");
    setLocationPreview(null); setMapLoading(false); setStatus(""); setLoading(false);
  }

  function locationCard() {
    if (!locationPreview) return null;
    const hasCoordinates =
      Number.isFinite(locationPreview.latitude) &&
      Number.isFinite(locationPreview.longitude);
    const mapSource = hasCoordinates
      ? `/api/location-map?lat=${encodeURIComponent(String(locationPreview.latitude))}&lng=${encodeURIComponent(String(locationPreview.longitude))}`
      : "";
    const place = [locationPreview.city, locationPreview.state].filter(Boolean).join(", ");

    return (
      <section className="location-preview-card" aria-label="Customer location preview">
        <div className="location-preview-copy">
          <span className="location-preview-eyebrow">Customer location</span>
          <h2>{place}</h2>
          {locationPreview.zip && <p>ZIP {locationPreview.zip}</p>}
          <strong className={locationPreview.inServiceArea ? "service-area-yes" : "service-area-no"}>
            {locationPreview.inServiceArea ? "✓ In Service Area" : "Outside Service Area"}
          </strong>
          {loading && <small>Denny is checking live schedules and routes now…</small>}
        </div>
        <div className="location-map-wrap">
          {mapSource ? (
            // The image is proxied by our authenticated server route so the
            // Google Maps key is never exposed to the browser.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mapSource} alt={`Map centered on ${place}`} />
          ) : (
            <div className="location-map-loading">
              {mapLoading ? "Loading map…" : "Map unavailable"}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <DenShell title="Denny’s Smart Scheduler" subtitle="Find the best sales consultant, date, and time" theme="schedule">
      <section className="schedule-hero">
        <div className="schedule-copy">
          <p className="eyebrow">Smarter routes. Better days.</p>
          <h1 className="display-title">Find the best appointment—<span>fast.</span></h1>
          <p>Enter a ZIP code, city, or address. Denny checks territories, schedules, drive time, and routing rules.</p>
        </div>
        <Image className="schedule-mascot" src="/brand/denny.png" alt="Coach Denny" width={500} height={500} priority />
      </section>

      <div className="schedule-workspace">
        <section className="schedule-panel surface">
          <label className="schedule-input-label" htmlFor="schedule-search">{conversation.length === 0 ? "Where does the customer live?" : "Ask Denny a follow-up question"}</label>
          <div className="schedule-search">
            <textarea
              id="schedule-search"
              className="den-textarea"
              value={input}
              placeholder={conversation.length === 0 ? "Enter ZIP code, city, or address…" : "Ask “Why?” or type another scheduling question…"}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault(); void askDenny();
                }
              }}
              aria-keyshortcuts="Enter"
            />
            <button className="btn btn-coral" onClick={askDenny} disabled={loading || !input.trim()}>{loading ? "Checking…" : conversation.length === 0 ? "Find Options" : "Ask Denny"} <span aria-hidden="true">→</span></button>
          </div>
          <div className="input-hint">Press Enter to search. Use Shift+Enter for a new line.</div>

          {status && <div className="notice" style={{ marginTop: 16 }}>{status}</div>}

          {conversation.length > 0 && <div className="conversation" aria-live="polite">
            {conversation.map((message, index) => (
              <Fragment key={`${message.role}-${index}`}>
                <article className={`message message-${message.role}`}>
                  <strong>{message.role === "user" ? "CSR" : "Denny"}</strong>
                  <pre>{message.content}</pre>
                </article>
                {index === 0 && locationCard()}
              </Fragment>
            ))}
            {pendingZipReply && !locationPreview && (
              <article className="message message-assistant">
                <strong>Denny</strong>
                <pre>{pendingZipReply}</pre>
              </article>
            )}
          </div>}

          {consultantChoices.length > 0 && <div className="consultant-box">
            <p>This ZIP code has more than one eligible owner. Choose the sales consultant:</p>
            <div className="consultant-options">{consultantChoices.map((name) => <button key={name} className="btn btn-amber" disabled={loading} onClick={() => chooseConsultant(name)}>{name}</button>)}</div>
          </div>}

          <div className="schedule-actions">
            {hasAssistantReply && consultantChoices.length === 0 && <button className="btn btn-coral" disabled={loading} onClick={nextThreeOptions}>Next 3 Options <span aria-hidden="true">→</span></button>}
            {conversation.length > 0 && <button className="btn btn-outline" disabled={loading} onClick={startNewSearch}>Start New Search</button>}
          </div>
        </section>

        <aside className="route-aside">
          <div className="route-status surface"><span className="route-icon">⌖</span><span><strong>Territory Verified</strong><small>ZIP ownership checked</small></span><span className="route-check">✓</span></div>
          <div className="route-status surface"><span className="route-icon">↗</span><span><strong>Drive Time Checked</strong><small>Real routes compared</small></span><span className="route-check">✓</span></div>
          <div className="route-status surface"><span className="route-icon">⌂</span><span><strong>Homeward Routing</strong><small>End-of-day direction applied</small></span><span className="route-check">✓</span></div>
          <div className="route-note surface"><h2>Smart routing at work</h2><p>Denny checks live schedules, territory rules, drive time, and the route home to find the best choices for the customer.</p></div>
        </aside>
      </div>
    </DenShell>
  );
}
