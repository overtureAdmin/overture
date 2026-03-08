import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { normalizeRole } from "@/lib/rbac";
import { isUnitySuperAdmin } from "@/lib/super-admin";

type QaAction =
  | "fresh_signup"
  | "reset_onboarding"
  | "accept_terms"
  | "accept_baa"
  | "complete_onboarding"
  | "set_role"
  | "seed_cases";

type QaBody = {
  organizationId: string;
  authSubject: string;
  action: QaAction;
  role?: string;
  count?: number;
};

const TERMS_VERSION = "unity-terms-v1-2026-02-28";
const BAA_VERSION = "unity-baa-v1-2026-02-28";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveTarget(client: PoolClient, organizationId: string, authSubject: string) {
  const identityResult = await client.query<{ email: string | null; display_name: string | null }>(
    `
      SELECT email, display_name
      FROM user_identity
      WHERE auth_subject = $1
      LIMIT 1
    `,
    [authSubject],
  );
  const identity = identityResult.rows[0];
  if (!identity) {
    throw new Error("Target user not found.");
  }

  await client.query(
    `
      INSERT INTO organization_membership (organization_id, auth_subject, role, status)
      VALUES ($1::uuid, $2, 'case_contributor', 'active')
      ON CONFLICT (organization_id, auth_subject)
      DO NOTHING
    `,
    [organizationId, authSubject],
  );

  await client.query(
    `
      INSERT INTO tenant (id, slug, name)
      VALUES ($1::uuid, $2, $3)
      ON CONFLICT (id) DO NOTHING
    `,
    [organizationId, organizationId, organizationId],
  );

  await client.query(
    `
      INSERT INTO app_user (tenant_id, auth_subject, email, display_name, role)
      VALUES ($1::uuid, $2, $3, $4, 'case_contributor')
      ON CONFLICT (tenant_id, auth_subject)
      DO UPDATE SET
        email = COALESCE(EXCLUDED.email, app_user.email),
        display_name = COALESCE(EXCLUDED.display_name, app_user.display_name),
        updated_at = NOW()
    `,
    [organizationId, authSubject, identity.email, identity.display_name],
  );

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
  const appUserId = appUserResult.rows[0]?.id;
  if (!appUserId) {
    throw new Error("Target user not found in app_user.");
  }

  const legalNameResult = await client.query<{
    legal_name: string | null;
    first_name: string | null;
    last_name: string | null;
  }>(
    `
      SELECT onb.legal_name, up.first_name, up.last_name
      FROM user_identity ui
      LEFT JOIN onboarding_state onb ON onb.auth_subject = ui.auth_subject
      LEFT JOIN user_profile up ON up.auth_subject = ui.auth_subject
      WHERE ui.auth_subject = $1
      LIMIT 1
    `,
    [authSubject],
  );
  const legal = legalNameResult.rows[0];
  const fallbackName = `${legal?.first_name ?? ""} ${legal?.last_name ?? ""}`.trim() || identity.display_name || identity.email || authSubject;
  const legalName = legal?.legal_name ?? fallbackName;

  return {
    email: identity.email ?? `${authSubject}@local.invalid`,
    legalName,
    appUserId,
  };
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
  const organizationId = searchParams.get("organizationId")?.trim() ?? "";
  const authSubject = searchParams.get("authSubject")?.trim() ?? "";
  if (!organizationId || !isUuid(organizationId) || !authSubject) {
    return jsonError("Missing or invalid query params: organizationId, authSubject", 422);
  }

  const db = getDbPool();
  try {
    const result = await db.query<{
      role: string;
      membership_status: string;
      organization_confirmed: boolean;
      pending_join_approval: boolean;
      onboarding_completed: boolean;
      terms_accepted: boolean;
      baa_accepted: boolean;
      thread_count: number;
    }>(
      `
        SELECT
          COALESCE(om.role, 'case_contributor') AS role,
          COALESCE(om.status, 'unknown') AS membership_status,
          (onb.organization_confirmed_at IS NOT NULL) AS organization_confirmed,
          (onb.pending_join_request_id IS NOT NULL) AS pending_join_approval,
          (onb.completed_at IS NOT NULL) AS onboarding_completed,
          EXISTS (
            SELECT 1 FROM terms_of_use_acceptance tua
            WHERE tua.organization_id = $1::uuid
              AND tua.auth_subject = $2
          ) AS terms_accepted,
          EXISTS (
            SELECT 1 FROM baa_acceptance ba
            WHERE ba.organization_id = $1::uuid
              AND ba.auth_subject = $2
          ) AS baa_accepted,
          (
            SELECT COUNT(*)::int
            FROM thread t
            WHERE t.tenant_id = $1::uuid
              AND t.created_by_user_id = au.id
          ) AS thread_count
        FROM app_user au
        LEFT JOIN organization_membership om
          ON om.organization_id = $1::uuid
         AND om.auth_subject = $2
        LEFT JOIN onboarding_state onb
          ON onb.auth_subject = $2
        WHERE au.tenant_id = $1::uuid
          AND au.auth_subject = $2
        LIMIT 1
      `,
      [organizationId, authSubject],
    );
    const row = result.rows[0];
    if (!row) {
      return jsonError("Target user not found in organization", 404);
    }
    return jsonOk({
      role: row.role,
      membershipStatus: row.membership_status,
      organizationConfirmed: row.organization_confirmed,
      pendingJoinApproval: row.pending_join_approval,
      onboardingCompleted: row.onboarding_completed,
      termsAccepted: row.terms_accepted,
      baaAccepted: row.baa_accepted,
      threadCount: row.thread_count,
    });
  } catch (error) {
    console.error("GET /api/admin/qa/user-tools failed", error);
    return jsonError("Failed to load QA user state", 500);
  }
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const body = await parseJsonBody<QaBody>(request);
  const organizationId = body?.organizationId?.trim() ?? "";
  const authSubject = body?.authSubject?.trim() ?? "";
  const action = body?.action;

  if (!organizationId || !isUuid(organizationId) || !authSubject || !action) {
    return jsonError("Missing required fields: organizationId, authSubject, action", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const target = await resolveTarget(client, organizationId, authSubject);

    if (action === "fresh_signup") {
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
        [authSubject, organizationId],
      );
    } else if (action === "reset_onboarding") {
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
      await client.query(
        `
          INSERT INTO onboarding_state (auth_subject, organization_id, completed_at, organization_confirmed_at, pending_join_request_id, updated_at)
          VALUES ($1, $2::uuid, NULL, NOW(), NULL, NOW())
          ON CONFLICT (auth_subject)
          DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            completed_at = NULL,
            organization_confirmed_at = NOW(),
            pending_join_request_id = NULL,
            updated_at = NOW()
        `,
        [authSubject, organizationId],
      );
    } else if (action === "accept_terms") {
      await client.query(
        `
          INSERT INTO terms_of_use_acceptance (organization_id, auth_subject, legal_name, signer_email, version, ip_address, user_agent)
          VALUES ($1::uuid, $2, $3, $4, $5, 'qa-tools', 'qa-tools')
        `,
        [organizationId, authSubject, target.legalName, target.email, TERMS_VERSION],
      );
    } else if (action === "accept_baa") {
      await client.query(
        `
          INSERT INTO baa_acceptance (organization_id, auth_subject, legal_name, signer_email, version, ip_address, user_agent)
          VALUES ($1::uuid, $2, $3, $4, $5, 'qa-tools', 'qa-tools')
        `,
        [organizationId, authSubject, target.legalName, target.email, BAA_VERSION],
      );
    } else if (action === "complete_onboarding") {
      await client.query(
        `
          INSERT INTO onboarding_state (auth_subject, organization_id, completed_at, organization_confirmed_at, pending_join_request_id, legal_name, updated_at)
          VALUES ($1, $2::uuid, NOW(), NOW(), NULL, $3, NOW())
          ON CONFLICT (auth_subject)
          DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            completed_at = NOW(),
            organization_confirmed_at = NOW(),
            pending_join_request_id = NULL,
            legal_name = COALESCE(onboarding_state.legal_name, EXCLUDED.legal_name),
            updated_at = NOW()
        `,
        [authSubject, organizationId, target.legalName],
      );
    } else if (action === "set_role") {
      const normalizedRole = normalizeRole(body.role);
      await client.query(
        `
          INSERT INTO organization_membership (organization_id, auth_subject, role, status)
          VALUES ($1::uuid, $2, $3, 'active')
          ON CONFLICT (organization_id, auth_subject)
          DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = NOW()
        `,
        [organizationId, authSubject, normalizedRole],
      );
      await client.query(
        `
          UPDATE app_user
          SET role = $3, updated_at = NOW()
          WHERE tenant_id = $1::uuid
            AND auth_subject = $2
        `,
        [organizationId, authSubject, normalizedRole],
      );
    } else if (action === "seed_cases") {
      const count = Math.max(1, Math.min(15, Number(body.count ?? 3)));
      for (let index = 0; index < count; index += 1) {
        const title = `QA Patient ${new Date().toISOString().slice(0, 10)} #${index + 1}`;
        const caseResult = await client.query<{ id: string }>(
          `
            INSERT INTO patient_case (tenant_id, title, patient_name, insurer_name, status, created_by_user_id)
            VALUES ($1::uuid, $2, $3, $4, 'open', $5::uuid)
            RETURNING id
          `,
          [organizationId, title, `Patient ${index + 1}`, "QA Payer", target.appUserId],
        );
        await client.query(
          `
            INSERT INTO thread (tenant_id, patient_case_id, title, created_by_user_id, updated_at)
            VALUES ($1::uuid, $2::uuid, $3, $4::uuid, NOW())
          `,
          [organizationId, caseResult.rows[0].id, title, target.appUserId],
        );
      }
    } else {
      await client.query("ROLLBACK");
      return jsonError("Unsupported action", 422);
    }

    await client.query(
      `
        INSERT INTO audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
        VALUES ($1::uuid, NULL, 'qa.user_tools', 'organization', $1::uuid, $2::jsonb)
      `,
      [
        organizationId,
        JSON.stringify({
          supportSubject: auth.userSub,
          targetAuthSubject: authSubject,
          action,
          role: body.role ?? null,
          count: body.count ?? null,
          correlationId: randomUUID(),
        }),
      ],
    );

    await client.query("COMMIT");
    return jsonOk({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/qa/user-tools failed", error);
    return jsonError("Failed to apply QA action", 500);
  } finally {
    client.release();
  }
}
