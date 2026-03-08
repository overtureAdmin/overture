import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type SubscriptionBody = {
  action: "start_solo_plan";
  planCode?: string;
};

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<SubscriptionBody>(request);
  if (!body || body.action !== "start_solo_plan") {
    return jsonError("Missing required field: action=start_solo_plan", 422);
  }

  const planCode = body.planCode?.trim() || "solo_monthly";

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    await client.query(
      `
        INSERT INTO org_subscription (organization_id, plan_code, status, provider, updated_at)
        VALUES ($1::uuid, $2, 'active', 'manual', NOW())
        ON CONFLICT (organization_id)
        DO UPDATE SET
          plan_code = EXCLUDED.plan_code,
          status = 'active',
          provider = EXCLUDED.provider,
          updated_at = NOW()
      `,
      [actor.organizationId, planCode],
    );
    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "subscription.updated",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        action: body.action,
        planCode,
        status: "active",
      },
    });
    await client.query("COMMIT");
    return jsonOk({ status: "active", planCode }, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/subscription failed", error);
    return jsonError("Failed to update subscription", 500);
  } finally {
    client.release();
  }
}
