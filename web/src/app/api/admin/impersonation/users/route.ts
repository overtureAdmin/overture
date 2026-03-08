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
  const organizationId = searchParams.get("organizationId")?.trim() ?? "";
  if (!organizationId) {
    return jsonError("Missing required query param: organizationId", 422);
  }

  const db = getDbPool();
  try {
    const usersResult = await db.query<{
      auth_subject: string;
      email: string | null;
      display_name: string | null;
      role: string;
      status: string;
    }>(
      `
        SELECT
          om.auth_subject,
          ui.email,
          ui.display_name,
          om.role,
          om.status
        FROM organization_membership om
        LEFT JOIN user_identity ui
          ON ui.auth_subject = om.auth_subject
        WHERE om.organization_id = $1::uuid
        ORDER BY om.status ASC, ui.display_name ASC NULLS LAST, ui.email ASC NULLS LAST, om.auth_subject ASC
        LIMIT 250
      `,
      [organizationId],
    );

    return jsonOk({
      users: usersResult.rows.map((row) => ({
        authSubject: row.auth_subject,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        membershipStatus: row.status,
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/impersonation/users failed", error);
    return jsonError("Failed to load organization users", 500);
  }
}
