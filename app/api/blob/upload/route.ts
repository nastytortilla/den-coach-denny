import { NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // This route does NOT receive the big file anymore.
    // It just hands the browser a temporary upload token + rules.
    const json = await req.json();

    const result = await handleUpload({
      body: json,
      request: req,

      onBeforeGenerateToken: async (pathname) => {
        // Basic safety checks
        const lower = pathname.toLowerCase();
        const ok =
          lower.endsWith(".mp3") ||
          lower.endsWith(".wav") ||
          lower.endsWith(".m4a") ||
          lower.endsWith(".ogg") ||
          lower.endsWith(".mp4");

        if (!ok) {
          throw new Error("Only audio files are allowed.");
        }

        return {
          allowedContentTypes: [
            "audio/mpeg",
            "audio/mp3",
            "audio/wav",
            "audio/x-wav",
            "audio/mp4",
            "audio/m4a",
            "audio/ogg",
            "video/mp4", // some m4a/mp4 uploads report as video/mp4
            "application/octet-stream",
          ],
          tokenPayload: JSON.stringify({
            // You can put metadata here if you want later
            uploadedAt: Date.now(),
          }),
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Optional: you can log, store metadata, etc.
        // Do NOT return anything from here.
        console.log("Blob upload completed:", blob.url, tokenPayload);
      },
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: "Blob upload route failed", details: err?.message || String(err) },
      { status: 400 }
    );
  }
}
