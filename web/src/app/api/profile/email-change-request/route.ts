import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { buildProfilePolicy } from "@/lib/profile-policy";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type EmailChangeBody = {
  newEmail: string;
};

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<EmailChangeBody>(request);
  const newEmail = typeof body?.newEmail === "string" ? normalizeEmail(body.newEmail) : "";
  if (!newEmail || !newEmail.includes("@")) {
    return jsonError("A valid email is required", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    const policy = buildProfilePolicy(actor);
    if (!policy.actions.canRequestEmailChange) {
      await client.query("ROLLBACK");
      return jsonError(policy.actions.emailChangeReason ?? "Email change request is not allowed", 403);
    }

    const currentEmailResult = await client.query<{ email: string | null }>(
      `SELECT email FROM user_identity WHERE auth_subject = $1 LIMIT 1`,
      [auth.userSub],
    );
    const currentEmail = normalizeEmail(currentEmailResult.rows[0]?.email ?? "");
    if (currentEmail && currentEmail === newEmail) {
      await client.query("ROLLBACK");
      return jsonError("New email must be different from current email", 422);
    }

    const duplicateResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM profile_change_request
        WHERE organization_id = $1::uuid
          AND auth_subject = $2
          AND request_type = 'email_change'
          AND status = 'open'
          AND LOWER(COALESCE(requested_value->>'newEmail', '')) = $3
        LIMIT 1
      `,
      [actor.organizationId, auth.userSub, newEmail],
    );
    if (duplicateResult.rows[0]?.id) {
      await client.query("COMMIT");
      return jsonOk({ requestId: duplicateResult.rows[0].id, status: "open", duplicate: true }, 200);
    }

    const insertResult = await client.query<{ id: string }>(
      `
        INSERT INTO profile_change_request (organization_id, auth_subject, request_type, requested_value)
        VALUES ($1::uuid, $2, 'email_change', $3::jsonb)
        RETURNING id
      `,
      [actor.organizationId, auth.userSub, JSON.stringify({ newEmail })],
    );

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "profile.email_change_requested",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        requestId: insertResult.rows[0].id,
      },
    });

    await client.query("COMMIT");
    return jsonOk({ requestId: insertResult.rows[0].id, status: "open", duplicate: false }, 201);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/email-change-request failed", error);
    return jsonError("Failed to create email change request", 500);
  } finally {
    client.release();
  }
}
