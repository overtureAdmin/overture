import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type OnboardingBody = {
  legalName: string;
  jobTitle?: string;
  phone?: string;
  organizationName?: string;
};

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<OnboardingBody>(request);
  if (!body?.legalName?.trim()) {
    return jsonError("Missing required field: legalName", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    await client.query(
      `
        INSERT INTO onboarding_state (auth_subject, organization_id, legal_name, job_title, phone, organization_name, completed_at, updated_at)
        VALUES ($1, $2::uuid, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (auth_subject)
        DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          legal_name = EXCLUDED.legal_name,
          job_title = EXCLUDED.job_title,
          phone = EXCLUDED.phone,
          organization_name = EXCLUDED.organization_name,
          completed_at = NOW(),
          updated_at = NOW()
      `,
      [
        auth.userSub,
        actor.organizationId,
        body.legalName.trim(),
        body.jobTitle?.trim() || null,
        body.phone?.trim() || null,
        body.organizationName?.trim() || null,
      ],
    );
    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "onboarding.completed",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        legalName: body.legalName.trim(),
      },
    });
    await client.query("COMMIT");
    return jsonOk({ completed: true }, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/onboarding failed", error);
    return jsonError("Failed to complete onboarding", 500);
  } finally {
    client.release();
  }
}
