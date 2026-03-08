import { NextResponse } from "next/server";
import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("unity_impersonation_session="));
  const sessionId = match?.split("=")[1];
  if (!sessionId) {
    return jsonError("No active impersonation session", 404);
  }

  const db = getDbPool();
  try {
    await db.query(
      `
        UPDATE support_impersonation_session
        SET status = 'ended', ended_at = NOW()
        WHERE id = $1::uuid
          AND support_subject = $2
          AND status = 'active'
      `,
      [decodeURIComponent(sessionId), auth.userSub],
    );
    const response = NextResponse.json({
      ok: true,
      requestId: crypto.randomUUID(),
      data: { active: false },
    });
    response.cookies.set("unity_impersonation_session", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: request.url.startsWith("https://"),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error("POST /api/admin/impersonation/stop failed", error);
    return jsonError("Failed to stop impersonation session", 500);
  }
}
