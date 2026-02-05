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

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    // Read form fields
    const formData = await req.formData();

    const file = formData.get("file");
    const callType = formData.get("callType");
    const goal = formData.get("goal");

    const callTypeText =
      typeof callType === "string" && callType.trim() ? callType.trim() : "Unknown";

    const goalText =
      typeof goal === "string" && goal.trim() ? goal.trim() : "Unknown";

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "No audio file received. Field name must be 'file'." },
        { status: 400 }
      );
    }

    // Build a filename OpenAI likes
    const anyFile = file as any;
    const mime = (file as any)?.type as string | undefined;
    const ext = pickExtFromMime(mime);

    const originalName =
      typeof anyFile?.name === "string" && anyFile.name.length > 0
        ? anyFile.name
        : `call-audio.${ext}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    const uploadedFile = await toFile(bytes, originalName);

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

    // 2) Coach (use shared prompt + include dropdown context)
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
