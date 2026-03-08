import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";

type ResetOrgOnboardingBody = {
  organizationId: string;
};

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

  const body = await parseJsonBody<ResetOrgOnboardingBody>(request);
  const organizationId = body?.organizationId?.trim() ?? "";
  if (!organizationId || !isUuid(organizationId)) {
    return jsonError("Missing or invalid field: organizationId", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const ownerResult = await client.query<{ auth_subject: string }>(
      `
        SELECT om.auth_subject
        FROM organization_membership om
        WHERE om.organization_id = $1::uuid
          AND om.status = 'active'
          AND om.role = 'org_owner'
        ORDER BY om.updated_at DESC, om.created_at DESC
        LIMIT 1
      `,
      [organizationId],
    );
    const ownerAuthSubject = ownerResult.rows[0]?.auth_subject;
    if (!ownerAuthSubject) {
      await client.query("ROLLBACK");
      return jsonError("Organization has no active org owner", 422);
    }

    await client.query(
      `
        DELETE FROM terms_of_use_acceptance
        WHERE organization_id = $1::uuid
          AND auth_subject = $2
      `,
      [organizationId, ownerAuthSubject],
    );
    await client.query(
      `
        DELETE FROM baa_acceptance
        WHERE organization_id = $1::uuid
          AND auth_subject = $2
      `,
      [organizationId, ownerAuthSubject],
    );
    await client.query(
      `
        INSERT INTO onboarding_state (auth_subject, organization_id, completed_at, organization_confirmed_at, pending_join_request_id, updated_at)
        VALUES ($1, $2::uuid, NULL, NULL, NULL, NOW())
        ON CONFLICT (auth_subject)
        DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          completed_at = NULL,
          organization_confirmed_at = NULL,
          pending_join_request_id = NULL,
          updated_at = NOW()
      `,
      [ownerAuthSubject, organizationId],
    );
    await client.query(
      `
        INSERT INTO audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
        VALUES ($1::uuid, NULL, 'admin.org_onboarding_reset', 'organization', $1::uuid, $2::jsonb)
      `,
      [
        organizationId,
        JSON.stringify({
          supportSubject: auth.userSub,
          ownerAuthSubject,
        }),
      ],
    );
    await client.query("COMMIT");
    return jsonOk({ ok: true, ownerAuthSubject });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/organizations/reset-onboarding failed", error);
    return jsonError("Failed to reset organization onboarding", 500);
  } finally {
    client.release();
  }
}
