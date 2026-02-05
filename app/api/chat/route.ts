import OpenAI from "openai";
import { NextResponse } from "next/server";
import { DEN_COACH_SYSTEM_PROMPT } from "@/app/lib/denCoachPrompt";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const input = typeof body?.input === "string" ? body.input : "";

    if (!input.trim()) {
      return NextResponse.json({ error: "Missing input" }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
  { role: "system", content: DEN_COACH_SYSTEM_PROMPT },
  { role: "user", content: input },
],

    });

    const reply =
      completion.choices?.[0]?.message?.content?.trim() || "No reply returned.";

    return NextResponse.json({ reply });
  } catch (err: any) {
    // ALWAYS return JSON (never empty)
    const status = err?.status || 500;
    const message = err?.message || String(err);

    return NextResponse.json(
      { error: "Server crashed in /api/chat", details: message },
      { status }
    );
  }
}
