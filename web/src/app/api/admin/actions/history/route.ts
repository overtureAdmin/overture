import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 100;
  const organizationId = searchParams.get("organizationId")?.trim() ?? "";
  if (organizationId && !isUuid(organizationId)) {
    return jsonError("Invalid organizationId", 422);
  }

  const db = getDbPool();
  try {
    const result = organizationId
      ? await db.query<{
          id: string;
          actor_subject: string;
          action: string;
          organization_id: string | null;
          target_auth_subject: string | null;
          metadata: Record<string, unknown> | null;
          created_at: string;
        }>(
          `
            SELECT
              id,
              actor_subject,
              action,
              organization_id,
              target_auth_subject,
              metadata,
              created_at
            FROM super_admin_action_log
            WHERE organization_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT $2
          `,
          [organizationId, limit],
        )
      : await db.query<{
          id: string;
          actor_subject: string;
          action: string;
          organization_id: string | null;
          target_auth_subject: string | null;
          metadata: Record<string, unknown> | null;
          created_at: string;
        }>(
          `
            SELECT
              id,
              actor_subject,
              action,
              organization_id,
              target_auth_subject,
              metadata,
              created_at
            FROM super_admin_action_log
            ORDER BY created_at DESC
            LIMIT $1
          `,
          [limit],
        );

    return jsonOk({
      entries: result.rows.map((row) => ({
        id: row.id,
        actorSubject: row.actor_subject,
        action: row.action,
        organizationId: row.organization_id,
        targetAuthSubject: row.target_auth_subject,
        metadata: row.metadata ?? {},
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42P01") {
      return jsonOk({ entries: [] });
    }
    console.error("GET /api/admin/actions/history failed", error);
    return jsonError("Failed to load admin action history", 500);
  }
}
