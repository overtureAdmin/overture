import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectedPath = pathname.startsWith("/app") || pathname.startsWith("/document");
  if (!protectedPath) {
    return NextResponse.next();
  }

  const tokenCookie =
    request.cookies.get("id_token")?.value ??
    request.cookies.get("access_token")?.value ??
    request.cookies.get("cognito_id_token")?.value;

  if (tokenCookie) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/app/:path*", "/document/:path*"],
};
