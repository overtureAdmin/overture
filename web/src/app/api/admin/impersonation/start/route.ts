import { NextResponse } from "next/server";
import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, parseJsonBody } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";

type ImpersonationStartBody = {
  targetOrganizationId: string;
  targetAuthSubject: string;
  reason: string;
};

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const body = await parseJsonBody<ImpersonationStartBody>(request);
  if (!body?.targetOrganizationId?.trim() || !body?.targetAuthSubject?.trim() || !body?.reason?.trim()) {
    return jsonError("Missing required fields: targetOrganizationId, targetAuthSubject, reason", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const membershipResult = await client.query<{ auth_subject: string }>(
      `
        SELECT om.auth_subject
        FROM organization_membership om
        WHERE om.organization_id = $1::uuid
          AND om.auth_subject = $2
          AND om.status = 'active'
        LIMIT 1
      `,
      [body.targetOrganizationId.trim(), body.targetAuthSubject.trim()],
    );
    if (!membershipResult.rows[0]?.auth_subject) {
      await client.query("ROLLBACK");
      return jsonError("Target user must be an active member of target organization", 422);
    }

    await client.query(
      `
        UPDATE support_impersonation_session
        SET status = 'ended',
            ended_at = NOW()
        WHERE support_subject = $1
          AND status = 'active'
      `,
      [auth.userSub],
    );

    const insertResult = await client.query<{ id: string }>(
      `
        INSERT INTO support_impersonation_session (support_subject, target_organization_id, target_auth_subject, reason)
        VALUES ($1, $2::uuid, $3, $4)
        RETURNING id
      `,
      [auth.userSub, body.targetOrganizationId.trim(), body.targetAuthSubject.trim(), body.reason.trim()],
    );
    await client.query("COMMIT");
    const sessionId = insertResult.rows[0].id;
    const response = NextResponse.json({
      ok: true,
      requestId: crypto.randomUUID(),
      data: {
        sessionId,
        active: true,
      },
    });
    response.cookies.set("unity_impersonation_session", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: request.url.startsWith("https://"),
      maxAge: 60 * 60,
    });
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/impersonation/start failed", error);
    return jsonError("Failed to start impersonation session", 500);
  } finally {
    client.release();
  }
}
