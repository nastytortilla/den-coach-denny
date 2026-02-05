import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      request,
      body,

      // IMPORTANT: this is where you can restrict uploads
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        // If you want to lock this down later, this is where auth checks go.
        // For now, keep it simple.

        return {
          // Allow common audio types
          allowedContentTypes: [
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/x-wav',
            'audio/mp4',
            'audio/m4a',
            'audio/webm',
            'audio/ogg',
          ],

          // Optional: cap size (example: 200MB)
          maximumSizeInBytes: 200 * 1024 * 1024,

          // Optional: avoid overwriting files with same name
          addRandomSuffix: true,
        };
      },

      onUploadCompleted: async ({ blob }) => {
        // You can log/store blob.url if you want
        console.log('Upload completed:', blob.url);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Upload failed' },
      { status: 400 }
    );
  }
}
