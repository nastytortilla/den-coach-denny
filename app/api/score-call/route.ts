import OpenAI from "openai";
import { NextResponse } from "next/server";
import { toFile } from "openai/uploads";
import { DEN_COACH_SYSTEM_PROMPT } from "@/app/lib/denCoachPrompt";

export const runtime = "nodejs";

function pickExtFromMime(mime?: string) {
  if (!mime) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "mp3";
}

function safeName(name: string) {
  // Keep it simple: strip weird path chars
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120);
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in environment variables." },
        { status: 500 }
      );
    }

    // ✅ NEW: expect JSON, not FormData
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body. Expected { blobUrl, callType?, goal?, originalName?, mimeType? }" },
        { status: 400 }
      );
    }

    const blobUrl = typeof body?.blobUrl === "string" ? body.blobUrl.trim() : "";
    const callTypeText =
      typeof body?.callType === "string" && body.callType.trim() ? body.callType.trim() : "Unknown";
    const goalText =
      typeof body?.goal === "string" && body.goal.trim() ? body.goal.trim() : "Unknown";

    if (!blobUrl) {
      return NextResponse.json(
        { error: "Missing blobUrl. Your client must upload to Blob first, then send { blobUrl } here." },
        { status: 400 }
      );
    }

    // Download the file from Vercel Blob URL
    let audioRes: Response;
    try {
      audioRes = await fetch(blobUrl);
    } catch (e: any) {
      return NextResponse.json(
        { error: "Could not fetch blobUrl.", details: e?.message || String(e) },
        { status: 400 }
      );
    }

    if (!audioRes.ok) {
      return NextResponse.json(
        { error: "Blob fetch failed.", details: `HTTP ${audioRes.status}` },
        { status: 400 }
      );
    }

    const mimeFromResponse = audioRes.headers.get("content-type") || undefined;
    const mimeFromClient = typeof body?.mimeType === "string" ? body.mimeType : undefined;
    const mime = mimeFromClient || mimeFromResponse;

    const ext = pickExtFromMime(mime);

    const originalNameFromClient =
      typeof body?.originalName === "string" && body.originalName.trim()
        ? body.originalName.trim()
        : "";

    const fallbackName = `call-audio.${ext}`;
    const fileName = safeName(originalNameFromClient || fallbackName);

    const bytes = Buffer.from(await audioRes.arrayBuffer());
    const uploadedFile = await toFile(bytes, fileName);

    const openai = new OpenAI({ apiKey });

    // 1) Transcribe
    const transcription = await openai.audio.transcriptions.create({
      file: uploadedFile,
      model: "gpt-4o-mini-transcribe",
    });

    const transcriptText = transcription.text?.trim() || "";
    if (!transcriptText) {
      return NextResponse.json(
        { error: "Transcription returned empty text." },
        { status: 500 }
      );
    }

    // 2) Coach (shared prompt + dropdown context)
    const coaching = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: DEN_COACH_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Call context:\n` +
            `- Call type: ${callTypeText}\n` +
            `- Goal: ${goalText}\n\n` +
            `Transcript:\n\n${transcriptText}`,
        },
      ],
    });

    const feedback =
      coaching.choices?.[0]?.message?.content?.trim() || "No feedback returned.";

    return NextResponse.json({
      transcript: transcriptText,
      feedback,
      callType: callTypeText,
      goal: goalText,
    });
  } catch (err: any) {
    console.error("score-call error:", err);

    return NextResponse.json(
      {
        error: "Server crash in /api/score-call",
        details: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
