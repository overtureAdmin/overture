import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";

type DeleteUserBody = {
  organizationId: string;
  authSubject: string;
};

async function superAdminLogTableExists(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ exists: string | null }> }> }) {
  const result = await client.query(
    `
      SELECT to_regclass('public.super_admin_action_log')::text AS exists
    `,
  );
  return result.rows[0]?.exists === "super_admin_action_log";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const body = await parseJsonBody<DeleteUserBody>(request);
  const organizationId = body?.organizationId?.trim() ?? "";
  const authSubject = body?.authSubject?.trim() ?? "";
  if (!organizationId || !isUuid(organizationId) || !authSubject) {
    return jsonError("Missing required fields: organizationId, authSubject", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const membershipResult = await client.query<{ role: string; status: string }>(
      `
        SELECT role, status
        FROM organization_membership
        WHERE organization_id = $1::uuid
          AND auth_subject = $2
        LIMIT 1
      `,
      [organizationId, authSubject],
    );
    const membership = membershipResult.rows[0];
    if (!membership) {
      await client.query("ROLLBACK");
      return jsonError("User is not a member of this organization", 404);
    }

    const appUserResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM app_user
        WHERE tenant_id = $1::uuid
          AND auth_subject = $2
        LIMIT 1
      `,
      [organizationId, authSubject],
    );
    const appUserId = appUserResult.rows[0]?.id ?? null;

    if (appUserId) {
      await client.query(
        `
          UPDATE patient_case
          SET created_by_user_id = NULL
          WHERE tenant_id = $1::uuid
            AND created_by_user_id = $2::uuid
        `,
        [organizationId, appUserId],
      );
      await client.query(
        `
          UPDATE thread
          SET created_by_user_id = NULL
          WHERE tenant_id = $1::uuid
            AND created_by_user_id = $2::uuid
        `,
        [organizationId, appUserId],
      );
      await client.query(
        `
          UPDATE message
          SET user_id = NULL
          WHERE tenant_id = $1::uuid
            AND user_id = $2::uuid
        `,
        [organizationId, appUserId],
      );
      await client.query(
        `
          UPDATE source_document
          SET uploaded_by_user_id = NULL
          WHERE tenant_id = $1::uuid
            AND uploaded_by_user_id = $2::uuid
        `,
        [organizationId, appUserId],
      );
      await client.query(
        `
          UPDATE generated_document
          SET created_by_user_id = NULL
          WHERE tenant_id = $1::uuid
            AND created_by_user_id = $2::uuid
        `,
        [organizationId, appUserId],
      );
      await client.query(
        `
          UPDATE audit_event
          SET actor_user_id = NULL
          WHERE tenant_id = $1::uuid
            AND actor_user_id = $2::uuid
        `,
        [organizationId, appUserId],
      );
      await client.query(
        `
          DELETE FROM app_user
          WHERE tenant_id = $1::uuid
            AND id = $2::uuid
        `,
        [organizationId, appUserId],
      );
    }

    await client.query(
      `
        DELETE FROM organization_membership
        WHERE organization_id = $1::uuid
          AND auth_subject = $2
      `,
      [organizationId, authSubject],
    );

    await client.query(
      `
        DELETE FROM terms_of_use_acceptance
        WHERE organization_id = $1::uuid
          AND auth_subject = $2
      `,
      [organizationId, authSubject],
    );

    await client.query(
      `
        DELETE FROM baa_acceptance
        WHERE organization_id = $1::uuid
          AND auth_subject = $2
      `,
      [organizationId, authSubject],
    );

    const nextHomeResult = await client.query<{ organization_id: string }>(
      `
        SELECT organization_id
        FROM organization_membership
        WHERE auth_subject = $1
          AND status = 'active'
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [authSubject],
    );
    const nextHomeOrganizationId = nextHomeResult.rows[0]?.organization_id ?? null;

    await client.query(
      `
        UPDATE user_identity
        SET home_organization_id = $2::uuid,
            updated_at = NOW()
        WHERE auth_subject = $1
          AND home_organization_id = $3::uuid
      `,
      [authSubject, nextHomeOrganizationId, organizationId],
    );

    await client.query(
      `
        UPDATE onboarding_state
        SET organization_id = $2::uuid,
            completed_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE completed_at END,
            organization_confirmed_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE organization_confirmed_at END,
            pending_join_request_id = CASE WHEN $2::uuid IS NULL THEN NULL ELSE pending_join_request_id END,
            updated_at = NOW()
        WHERE auth_subject = $1
          AND organization_id = $3::uuid
      `,
      [authSubject, nextHomeOrganizationId, organizationId],
    );

    await client.query(
      `
        UPDATE support_impersonation_session
        SET status = 'ended',
            ended_at = NOW()
        WHERE status = 'active'
          AND target_organization_id = $1::uuid
          AND target_auth_subject = $2
      `,
      [organizationId, authSubject],
    );

    if (await superAdminLogTableExists(client)) {
      await client.query(
        `
          INSERT INTO super_admin_action_log (
            actor_subject,
            action,
            organization_id,
            target_auth_subject,
            metadata
          )
          VALUES ($1, 'admin.user_delete', $2::uuid, $3, $4::jsonb)
        `,
        [
          auth.userSub,
          organizationId,
          authSubject,
          JSON.stringify({
            removedRole: membership.role,
            removedStatus: membership.status,
            nextHomeOrganizationId,
            hadAppUserRecord: appUserId !== null,
          }),
        ],
      );
    }

    await client.query("COMMIT");
    return jsonOk({
      ok: true,
      organizationId,
      authSubject,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/users/delete failed", error);
    const code = (error as { code?: string } | null)?.code;
    return jsonError(code ? `Failed to delete user (${code})` : "Failed to delete user", 500);
  } finally {
    client.release();
  }
}
