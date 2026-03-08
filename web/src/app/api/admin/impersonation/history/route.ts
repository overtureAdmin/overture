import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const db = getDbPool();
  try {
    const historyResult = await db.query<{
      id: string;
      status: "active" | "ended";
      reason: string;
      started_at: string;
      ended_at: string | null;
      target_organization_id: string | null;
      target_auth_subject: string | null;
      target_organization_name: string | null;
      target_email: string | null;
      target_display_name: string | null;
    }>(
      `
        SELECT
          sis.id,
          sis.status,
          sis.reason,
          sis.started_at,
          sis.ended_at,
          sis.target_organization_id,
          sis.target_auth_subject,
          o.name AS target_organization_name,
          ui.email AS target_email,
          ui.display_name AS target_display_name
        FROM support_impersonation_session sis
        LEFT JOIN organization o
          ON o.id = sis.target_organization_id
        LEFT JOIN user_identity ui
          ON ui.auth_subject = sis.target_auth_subject
        WHERE sis.support_subject = $1
        ORDER BY sis.started_at DESC
        LIMIT $2
      `,
      [auth.userSub, limit],
    );

    return jsonOk({
      history: historyResult.rows.map((row) => ({
        sessionId: row.id,
        status: row.status,
        reason: row.reason,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        targetOrganizationId: row.target_organization_id,
        targetOrganizationName: row.target_organization_name ?? "Unknown Organization",
        targetAuthSubject: row.target_auth_subject,
        targetUserDisplay: row.target_display_name ?? row.target_email ?? row.target_auth_subject ?? "Unknown User",
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/impersonation/history failed", error);
    return jsonError("Failed to load impersonation history", 500);
  }
}
