import { randomBytes } from "node:crypto";
import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type SetupBody =
  | {
      action: "create";
      organizationName: string;
    }
  | {
      action: "join";
      inviteCode: string;
    };

function buildSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function randomSuffix() {
  return randomBytes(3).toString("hex");
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<SetupBody>(request);
  if (!body || (body.action !== "create" && body.action !== "join")) {
    return jsonError("Missing required field: action=create|join", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);

    if (body.action === "create") {
      const organizationName = body.organizationName?.trim();
      if (!organizationName) {
        await client.query("ROLLBACK");
        return jsonError("Missing required field: organizationName", 422);
      }

      const slugBase = buildSlug(organizationName) || `org-${randomSuffix()}`;
      const nextSlug = `${slugBase}-${randomSuffix()}`;

      await client.query(
        `
          UPDATE organization
          SET name = $2,
              slug = COALESCE(NULLIF($3, ''), slug),
              account_type = 'enterprise',
              status = 'verified',
              updated_at = NOW()
          WHERE id = $1::uuid
        `,
        [actor.organizationId, organizationName, nextSlug],
      );

      await client.query(
        `
          UPDATE onboarding_state
          SET organization_name = $2,
              organization_confirmed_at = NOW(),
              pending_join_request_id = NULL,
              updated_at = NOW()
          WHERE auth_subject = $1
        `,
        [auth.userSub, organizationName],
      );

      await insertAuditEvent(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "organization.confirmed",
        entityType: "organization",
        entityId: actor.organizationId,
        metadata: { mode: "create" },
      });
      await client.query("COMMIT");
      return jsonOk({ ok: true });
    }

    const inviteCode = body.inviteCode?.trim().toUpperCase();
    if (!inviteCode) {
      await client.query("ROLLBACK");
      return jsonError("Missing required field: inviteCode", 422);
    }

    const inviteResult = await client.query<{
      id: string;
      organization_id: string;
      default_role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
    }>(
      `
        SELECT id, organization_id, default_role
        FROM organization_invite_code
        WHERE code = $1
          AND status = 'active'
          AND expires_at > NOW()
          AND used_count < max_uses
        LIMIT 1
      `,
      [inviteCode],
    );

    const invite = inviteResult.rows[0];
    if (!invite?.id) {
      await client.query("ROLLBACK");
      return jsonError("Invite code is invalid or expired", 422);
    }

    await client.query(
      `
        INSERT INTO organization_membership (organization_id, auth_subject, role, status)
        VALUES ($1::uuid, $2, $3, 'invited')
        ON CONFLICT (organization_id, auth_subject)
        DO UPDATE SET role = EXCLUDED.role, status = 'invited', updated_at = NOW()
      `,
      [invite.organization_id, auth.userSub, invite.default_role],
    );

    const pendingResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM organization_join_request
        WHERE organization_id = $1::uuid
          AND auth_subject = $2
          AND status = 'pending'
        LIMIT 1
      `,
      [invite.organization_id, auth.userSub],
    );

    const pendingId = pendingResult.rows[0]?.id;
    let requestId = pendingId;
    if (!pendingId) {
      const insertRequestResult = await client.query<{ id: string }>(
        `
          INSERT INTO organization_join_request (organization_id, auth_subject, email, invite_code_id, requested_role, status)
          VALUES ($1::uuid, $2, $3, $4::uuid, $5, 'pending')
          RETURNING id
        `,
        [invite.organization_id, auth.userSub, auth.email, invite.id, invite.default_role],
      );
      requestId = insertRequestResult.rows[0].id;
      await client.query(
        `
          UPDATE organization_invite_code
          SET used_count = used_count + 1, updated_at = NOW()
          WHERE id = $1::uuid
        `,
        [invite.id],
      );
    }

    await client.query(
      `
        UPDATE onboarding_state
        SET pending_join_request_id = $2::uuid,
            organization_confirmed_at = NULL,
            updated_at = NOW()
        WHERE auth_subject = $1
      `,
      [auth.userSub, requestId],
    );

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "organization.join_requested",
      entityType: "organization",
      entityId: invite.organization_id,
      metadata: { inviteCode },
    });
    await client.query("COMMIT");
    return jsonOk({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/organization/setup failed", error);
    return jsonError("Failed to update organization setup", 500);
  } finally {
    client.release();
  }
}
