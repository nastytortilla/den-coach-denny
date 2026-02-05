import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Missing BLOB_READ_WRITE_TOKEN" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const filename = searchParams.get("filename") || "audio.mp3";

    // Raw bytes from browser
    const contentType = req.headers.get("content-type") || "application/octet-stream";
    const fileBuffer = Buffer.from(await req.arrayBuffer());

    const blob = await put(filename, fileBuffer, {
      access: "public", // keep audio private
      contentType,
      token,
      addRandomSuffix: true,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Blob upload failed", details: err?.message || String(err) },
      { status: 500 }
    );
  }
}
