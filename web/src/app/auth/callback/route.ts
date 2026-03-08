import { NextRequest, NextResponse } from "next/server";
import { authFlowCookies, getHostedAuthConfig, getRequestOrigin, secureCookieForOrigin } from "@/lib/hosted-auth";

type CognitoTokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

async function exchangeCodeForTokens(params: {
  tokenUrl: string;
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(params.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  return (await response.json()) as CognitoTokenResponse;
}

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);
  const config = getHostedAuthConfig(origin);
  const providerError = request.nextUrl.searchParams.get("error");
  const providerErrorDescription = request.nextUrl.searchParams.get("error_description");
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");

  const cookies = authFlowCookies();
  const expectedState = request.cookies.get(cookies.state)?.value;
  const codeVerifier = request.cookies.get(cookies.verifier)?.value;
  const nextPath = request.cookies.get(cookies.next)?.value ?? "/app";

  const errorRedirect = new URL("/login", origin);
  errorRedirect.searchParams.set("next", nextPath);

  if (providerError) {
    errorRedirect.searchParams.set("error", "auth_provider_error");
    if (providerErrorDescription) {
      errorRedirect.searchParams.set("reason", providerErrorDescription);
    }
    return NextResponse.redirect(errorRedirect);
  }

  if (!code || !returnedState || !expectedState || !codeVerifier || expectedState !== returnedState) {
    errorRedirect.searchParams.set("error", "auth_callback_invalid_state");
    return NextResponse.redirect(errorRedirect);
  }

  try {
    const tokens = await exchangeCodeForTokens({
      tokenUrl: config.tokenUrl,
      code,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      codeVerifier,
    });

    const successRedirect = NextResponse.redirect(new URL(nextPath, origin));
    const secure = secureCookieForOrigin(origin);

    successRedirect.cookies.set("id_token", tokens.id_token ?? "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: tokens.expires_in,
    });
    successRedirect.cookies.set("access_token", tokens.access_token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: tokens.expires_in,
    });
    if (tokens.refresh_token) {
      successRedirect.cookies.set("refresh_token", tokens.refresh_token, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    successRedirect.cookies.delete(cookies.state);
    successRedirect.cookies.delete(cookies.verifier);
    successRedirect.cookies.delete(cookies.next);

    return successRedirect;
  } catch {
    errorRedirect.searchParams.set("error", "auth_token_exchange_failed");
    const response = NextResponse.redirect(errorRedirect);
    response.cookies.delete(cookies.state);
    response.cookies.delete(cookies.verifier);
    response.cookies.delete(cookies.next);
    return response;
  }
}
