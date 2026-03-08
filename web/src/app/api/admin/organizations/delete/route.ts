import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";

type DeleteOrganizationBody = {
  organizationId: string;
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

  const body = await parseJsonBody<DeleteOrganizationBody>(request);
  const organizationId = body?.organizationId?.trim() ?? "";
  if (!organizationId || !isUuid(organizationId)) {
    return jsonError("Missing required field: organizationId", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const orgResult = await client.query<{ name: string }>(
      `
        SELECT name
        FROM organization
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [organizationId],
    );
    const organizationName = orgResult.rows[0]?.name;
    if (!organizationName) {
      await client.query("ROLLBACK");
      return jsonError("Organization not found", 404);
    }

    const subjectsResult = await client.query<{ auth_subject: string }>(
      `
        SELECT DISTINCT auth_subject
        FROM organization_membership
        WHERE organization_id = $1::uuid
      `,
      [organizationId],
    );
    const authSubjects = subjectsResult.rows.map((row) => row.auth_subject);

    await client.query(
      `
        DELETE FROM tenant
        WHERE id = $1::uuid
      `,
      [organizationId],
    );

    const deleteResult = await client.query<{ id: string }>(
      `
        DELETE FROM organization
        WHERE id = $1::uuid
        RETURNING id
      `,
      [organizationId],
    );
    if (deleteResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      return jsonError("Organization delete did not remove a row", 409);
    }

    if (authSubjects.length > 0) {
      // Preserve user identity/profile records for audit and potential future re-activation.
      // Remove org linkage and force onboarding to restart for users whose home org was deleted.
      await client.query(
        `
          UPDATE user_identity ui
          SET home_organization_id = NULL,
              updated_at = NOW()
          WHERE ui.auth_subject = ANY($1::text[])
            AND ui.home_organization_id = $2::uuid
        `,
        [authSubjects, organizationId],
      );

      await client.query(
        `
          UPDATE onboarding_state os
          SET organization_id = NULL,
              completed_at = NULL,
              organization_confirmed_at = NULL,
              pending_join_request_id = NULL,
              updated_at = NOW()
          WHERE os.auth_subject = ANY($1::text[])
            AND os.organization_id = $2::uuid
        `,
        [authSubjects, organizationId],
      );
    }

    const existsAfterDeleteResult = await client.query<{ still_exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM organization
          WHERE id = $1::uuid
        ) AS still_exists
      `,
      [organizationId],
    );
    if (existsAfterDeleteResult.rows[0]?.still_exists) {
      throw new Error("Organization still exists after delete attempt");
    }

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
          VALUES ($1, 'admin.organization_delete', $2::uuid, NULL, $3::jsonb)
        `,
        [
          auth.userSub,
          organizationId,
          JSON.stringify({
            organizationName,
            affectedUsers: authSubjects.length,
          }),
        ],
      );
    }

    await client.query("COMMIT");
    return jsonOk({
      ok: true,
      organizationId,
      organizationName,
      affectedUsers: authSubjects.length,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/organizations/delete failed", error);
    const code = (error as { code?: string } | null)?.code;
    return jsonError(code ? `Failed to delete organization (${code})` : "Failed to delete organization", 500);
  } finally {
    client.release();
  }
}
