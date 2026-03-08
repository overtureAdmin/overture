import { NextRequest, NextResponse } from "next/server";
import {
  authFlowCookies,
  createPkcePair,
  createState,
  getHostedAuthConfig,
  getRequestOrigin,
  normalizeNextPath,
  secureCookieForOrigin,
} from "@/lib/hosted-auth";

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);
  const config = getHostedAuthConfig(origin);
  const nextPath = normalizeNextPath(request.nextUrl.searchParams.get("next"), "/app");

  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const authorizeUrl = new URL(config.authorizeUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("scope", "openid email profile aws.cognito.signin.user.admin");
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  const secure = secureCookieForOrigin(origin);
  const cookies = authFlowCookies();

  response.cookies.set(cookies.state, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  response.cookies.set(cookies.verifier, verifier, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  response.cookies.set(cookies.next, nextPath, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
