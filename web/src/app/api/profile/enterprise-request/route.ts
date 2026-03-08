import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type EnterpriseRequestBody = {
  organizationName: string;
  requestNotes?: string;
};

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<EnterpriseRequestBody>(request);
  if (!body?.organizationName?.trim()) {
    return jsonError("Missing required field: organizationName", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    const insertResult = await client.query<{ id: string }>(
      `
        INSERT INTO enterprise_contact_request (auth_subject, email, organization_name, request_notes)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [auth.userSub, auth.email, body.organizationName.trim(), body.requestNotes?.trim() || null],
    );
    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "enterprise.contact_request.created",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        requestId: insertResult.rows[0].id,
        organizationName: body.organizationName.trim(),
      },
    });
    await client.query("COMMIT");
    return jsonOk({ requestId: insertResult.rows[0].id, status: "open" }, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/enterprise-request failed", error);
    return jsonError("Failed to submit enterprise request", 500);
  } finally {
    client.release();
  }
}
