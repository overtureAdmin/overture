import { NextRequest, NextResponse } from "next/server";
import { getHostedAuthConfig, getRequestOrigin, normalizeNextPath, secureCookieForOrigin } from "@/lib/hosted-auth";

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);
  const config = getHostedAuthConfig(origin);
  const nextPath = normalizeNextPath(request.nextUrl.searchParams.get("next"), "/login");

  const postLogoutUrl = new URL(nextPath, origin).toString();
  const cognitoLogout = new URL(config.logoutUrl);
  cognitoLogout.searchParams.set("client_id", config.clientId);
  cognitoLogout.searchParams.set("logout_uri", postLogoutUrl);

  const response = NextResponse.redirect(cognitoLogout);
  const secure = secureCookieForOrigin(origin);

  response.cookies.set("id_token", "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("access_token", "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("refresh_token", "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
