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

  const db = getDbPool();
  try {
    const organizationsResult = await db.query<{
      id: string;
      name: string;
      status: "verified" | "pending_verification" | "suspended";
      account_type: "solo" | "enterprise";
      active_users: number;
      owner_auth_subject: string | null;
      owner_email: string | null;
      owner_display_name: string | null;
      owner_terms_accepted: boolean;
      owner_baa_accepted: boolean;
    }>(
      `
        SELECT
          o.id,
          o.name,
          o.status,
          o.account_type,
          COUNT(om.auth_subject) FILTER (WHERE om.status = 'active')::int AS active_users,
          owner.auth_subject AS owner_auth_subject,
          owner.email AS owner_email,
          owner.display_name AS owner_display_name,
          EXISTS (
            SELECT 1
            FROM terms_of_use_acceptance tua
            WHERE tua.organization_id = o.id
              AND tua.auth_subject = owner.auth_subject
          ) AS owner_terms_accepted,
          EXISTS (
            SELECT 1
            FROM baa_acceptance ba
            WHERE ba.organization_id = o.id
              AND ba.auth_subject = owner.auth_subject
          ) AS owner_baa_accepted
        FROM organization o
        LEFT JOIN organization_membership om
          ON om.organization_id = o.id
        LEFT JOIN LATERAL (
          SELECT
            om2.auth_subject,
            ui.email,
            ui.display_name
          FROM organization_membership om2
          LEFT JOIN user_identity ui
            ON ui.auth_subject = om2.auth_subject
          WHERE om2.organization_id = o.id
            AND om2.status = 'active'
            AND om2.role = 'org_owner'
          ORDER BY om2.updated_at DESC, om2.created_at DESC
          LIMIT 1
        ) owner ON TRUE
        GROUP BY
          o.id,
          o.name,
          o.status,
          o.account_type,
          owner.auth_subject,
          owner.email,
          owner.display_name
        ORDER BY o.updated_at DESC, o.created_at DESC
        LIMIT 200
      `,
    );

    const activeSessionResult = await db.query<{
      id: string;
      reason: string;
      started_at: string;
      target_organization_id: string;
      target_auth_subject: string;
      organization_name: string | null;
      target_email: string | null;
      target_display_name: string | null;
    }>(
      `
        SELECT
          sis.id,
          sis.reason,
          sis.started_at,
          sis.target_organization_id,
          sis.target_auth_subject,
          o.name AS organization_name,
          ui.email AS target_email,
          ui.display_name AS target_display_name
        FROM support_impersonation_session sis
        LEFT JOIN organization o
          ON o.id = sis.target_organization_id
        LEFT JOIN user_identity ui
          ON ui.auth_subject = sis.target_auth_subject
        WHERE sis.support_subject = $1
          AND sis.status = 'active'
        ORDER BY sis.started_at DESC
        LIMIT 1
      `,
      [auth.userSub],
    );

    const activeSession = activeSessionResult.rows[0] ?? null;

    return jsonOk({
      isSuperAdmin: true,
      superAdminSubject: auth.userSub,
      activeSession: activeSession
        ? {
            sessionId: activeSession.id,
            reason: activeSession.reason,
            startedAt: activeSession.started_at,
            targetOrganizationId: activeSession.target_organization_id,
            targetOrganizationName: activeSession.organization_name ?? "Unknown Organization",
            targetAuthSubject: activeSession.target_auth_subject,
            targetUserDisplay:
              activeSession.target_display_name ??
              activeSession.target_email ??
              activeSession.target_auth_subject,
          }
        : null,
      organizations: organizationsResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        accountType: row.account_type,
        activeUsers: row.active_users,
        ownerAuthSubject: row.owner_auth_subject,
        ownerEmail: row.owner_email,
        ownerDisplayName: row.owner_display_name,
        ownerTermsAccepted: row.owner_terms_accepted,
        ownerBaaAccepted: row.owner_baa_accepted,
      })),
    });
  } catch (error) {
    console.error("GET /api/admin/impersonation/context failed", error);
    return jsonError("Failed to load super admin context", 500);
  }
}
