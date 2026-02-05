import OpenAI from "openai";
import { NextResponse } from "next/server";
import { toFile } from "openai/uploads";
import { DEN_COACH_SYSTEM_PROMPT } from "@/app/lib/denCoachPrompt";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    const blobUrl = body?.blobUrl as string | undefined;

    const callTypeText =
      typeof body?.callType === "string" && body.callType.trim()
        ? body.callType.trim()
        : "Unknown";

    const goalText =
      typeof body?.goal === "string" && body.goal.trim()
        ? body.goal.trim()
        : "Unknown";

    if (!blobUrl) {
      return NextResponse.json(
        { error: "Missing blobUrl" },
        { status: 400 }
      );
    }

    // Download the file from Blob (server-side)
    const fileRes = await fetch(blobUrl);
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch blobUrl", details: `HTTP ${fileRes.status}` },
        { status: 400 }
      );
    }

    const contentType = fileRes.headers.get("content-type") || "audio/mpeg";
    const ext =
      contentType.includes("wav") ? "wav" :
      contentType.includes("mp4") || contentType.includes("m4a") ? "m4a" :
      contentType.includes("ogg") ? "ogg" :
      "mp3";

    const bytes = Buffer.from(await fileRes.arrayBuffer());
    const uploadedFile = await toFile(bytes, `call.${ext}`);

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

    // 2) Coach
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
    return NextResponse.json(
      { error: "Server crash in /api/score-call", details: err?.message || String(err) },
      { status: 500 }
    );
  }
}
