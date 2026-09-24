import { auth0 } from "@/lib/auth0";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth0.getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) return new Response("Google Maps preview is not configured.", { status: 503 });

  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lng"));
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return new Response("Invalid map coordinates.", { status: 400 });
  }

  const point = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  const mapParams = new URLSearchParams({
    center: point,
    zoom: "10",
    size: "640x300",
    scale: "2",
    maptype: "roadmap",
    markers: `color:0xf23838|label:D|${point}`,
    key: apiKey,
  });

  try {
    const mapResponse = await fetch(
      `https://maps.googleapis.com/maps/api/staticmap?${mapParams.toString()}`,
      { next: { revalidate: 86400 } }
    );
    if (!mapResponse.ok || !mapResponse.body) {
      return new Response("Google Maps could not create the preview.", { status: 502 });
    }

    return new Response(mapResponse.body, {
      status: 200,
      headers: {
        "Content-Type": mapResponse.headers.get("content-type") || "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new Response("Google Maps preview failed.", { status: 502 });
  }
}
