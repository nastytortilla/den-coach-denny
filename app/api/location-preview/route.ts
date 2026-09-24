import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import salesZipDirectory from "@/app/lib/salesZipDirectory.json";

export const runtime = "nodejs";

type ZipDirectory = Record<string, [string, string]>;
const SERVICE_ZIPS = salesZipDirectory as unknown as ZipDirectory;

function addressPart(
  components: Array<{ long_name?: string; short_name?: string; types?: string[] }>,
  types: string[],
  short = false
) {
  const component = components.find((item) =>
    types.some((type) => item.types?.includes(type))
  );
  return String(short ? component?.short_name || "" : component?.long_name || "").trim();
}

function approvedCityZip(city: string, state: string) {
  const normalizedCity = city.toLowerCase();
  const normalizedState = state.toUpperCase();
  return Object.entries(SERVICE_ZIPS).find(([, location]) =>
    location[0].toLowerCase() === normalizedCity &&
    location[1].toUpperCase() === normalizedState
  )?.[0];
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const location = String(body?.location || "").trim().slice(0, 300);
  if (location.length < 2) {
    return NextResponse.json({ error: "Enter a ZIP code, city, or address." }, { status: 400 });
  }

  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Maps preview is not configured." },
      { status: 503 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const params = new URLSearchParams({
      address: location,
      components: "country:US",
      key: apiKey,
    });
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
      { signal: controller.signal, cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error(`Google Geocoding returned ${response.status}.`);
    }

    const payload = await response.json();
    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    const latitude = Number(result?.geometry?.location?.lat);
    const longitude = Number(result?.geometry?.location?.lng);
    const components = Array.isArray(result?.address_components)
      ? result.address_components
      : [];

    if (!result || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json(
        { error: "I could not locate that ZIP code, city, or address on the map." },
        { status: 404 }
      );
    }

    const city =
      addressPart(components, ["locality", "postal_town"]) ||
      addressPart(components, ["sublocality", "administrative_area_level_3"]) ||
      addressPart(components, ["administrative_area_level_2"]);
    const state = addressPart(components, ["administrative_area_level_1"], true);
    const returnedZip = addressPart(components, ["postal_code"]);
    const typedZip = location.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || "";
    const zip = returnedZip || typedZip || approvedCityZip(city, state) || "";
    const directoryLocation = zip ? SERVICE_ZIPS[zip] : undefined;
    const inServiceArea = Boolean(directoryLocation || approvedCityZip(city, state));

    return NextResponse.json({
      city: directoryLocation?.[0] || city || String(result.formatted_address || location),
      state: directoryLocation?.[1] || state,
      zip,
      latitude,
      longitude,
      inServiceArea,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Map lookup failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
