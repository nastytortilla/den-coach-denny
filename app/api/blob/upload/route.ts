import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get("filename") || "audio.mp3";

    // Browser sends the raw file bytes to this route
    const blob = await req.blob();

    // Upload to Vercel Blob
    const uploaded = await put(filename, blob, {
      access: "public", // easiest
      addRandomSuffix: true,
    });

    return NextResponse.json({
      url: uploaded.url,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "blob upload failed", details: err?.message || String(err) },
      { status: 500 }
    );
  }
}
