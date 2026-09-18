import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export const runtime = "nodejs";

export async function GET() {
  try {
    const accessToken = await auth0.getAccessToken();

    const tokenParts = accessToken.token.split(".");

    if (tokenParts.length !== 3) {
      return NextResponse.json({
        success: false,
        message: "The access token could not be inspected.",
      });
    }

    const claims = JSON.parse(
      Buffer.from(tokenParts[1], "base64url").toString("utf8")
    );

    const scope =
      typeof claims.scope === "string"
        ? claims.scope
        : accessToken.scope || "";

    const permissions = Array.isArray(claims.permissions)
      ? claims.permissions
      : [];

    const hasServiceTitanRead =
      scope.split(" ").includes("servicetitan.read") ||
      permissions.includes("servicetitan.read");

    return NextResponse.json({
      success: true,
      audience: claims.aud || accessToken.audience || null,
      scope,
      permissions,
      hasServiceTitanRead,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Unable to inspect the access token.",
      },
      { status: 401 }
    );
  }
}