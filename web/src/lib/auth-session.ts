import { NextResponse } from "next/server";

export function applyAuthCookies(
  response: NextResponse,
  params: {
    accessToken: string;
    idToken?: string;
    refreshToken?: string;
    expiresIn: number;
    secure: boolean;
    rememberMe?: boolean;
  },
) {
  const cookieBase = {
    httpOnly: true as const,
    secure: params.secure,
    sameSite: "lax" as const,
    path: "/",
  };

  const persistent = params.rememberMe !== false;
  const tokenOptions = persistent ? { ...cookieBase, maxAge: params.expiresIn } : cookieBase;

  response.cookies.set("access_token", params.accessToken, tokenOptions);
  if (params.idToken) {
    response.cookies.set("id_token", params.idToken, tokenOptions);
  }

  if (params.refreshToken && persistent) {
    response.cookies.set("refresh_token", params.refreshToken, {
      ...cookieBase,
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    response.cookies.delete("refresh_token");
  }
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.delete("id_token");
  response.cookies.delete("access_token");
  response.cookies.delete("refresh_token");
}
