import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { denyIfNoPermission } from "@/lib/access";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type ReviewBody = {
  requestId: string;
  decision: "approve" | "reject";
};

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const deny = denyIfNoPermission(actor, "org:manage");
    if (deny) {
      return deny;
    }

    const result = await db.query<{
      id: string;
      auth_subject: string;
      email: string | null;
      requested_role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
      status: "pending" | "approved" | "rejected";
      created_at: string;
    }>(
      `
        SELECT id, auth_subject, email, requested_role, status, created_at
        FROM organization_join_request
        WHERE organization_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [actor.organizationId],
    );

    return jsonOk({
      requests: result.rows.map((row) => ({
        id: row.id,
        authSubject: row.auth_subject,
        email: row.email,
        requestedRole: row.requested_role,
        status: row.status,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("GET /api/profile/organization/join-requests failed", error);
    return jsonError("Failed to load join requests", 500);
  }
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<ReviewBody>(request);
  if (!body?.requestId?.trim() || !body.decision || (body.decision !== "approve" && body.decision !== "reject")) {
    return jsonError("Missing required fields: requestId, decision=approve|reject", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    const deny = denyIfNoPermission(actor, "org:manage");
    if (deny) {
      await client.query("ROLLBACK");
      return deny;
    }

    const requestResult = await client.query<{
      id: string;
      organization_id: string;
      auth_subject: string;
      requested_role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
      status: "pending" | "approved" | "rejected";
    }>(
      `
        SELECT id, organization_id, auth_subject, requested_role, status
        FROM organization_join_request
        WHERE id = $1::uuid
          AND organization_id = $2::uuid
        LIMIT 1
      `,
      [body.requestId.trim(), actor.organizationId],
    );

    const row = requestResult.rows[0];
    if (!row?.id) {
      await client.query("ROLLBACK");
      return jsonError("Join request not found", 404);
    }
    if (row.status !== "pending") {
      await client.query("ROLLBACK");
      return jsonError("Join request already reviewed", 422);
    }

    const nextStatus = body.decision === "approve" ? "approved" : "rejected";
    await client.query(
      `
        UPDATE organization_join_request
        SET status = $2,
            reviewed_by_subject = $3,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [row.id, nextStatus, auth.userSub],
    );

    if (body.decision === "approve") {
      await client.query(
        `
          INSERT INTO organization_membership (organization_id, auth_subject, role, status)
          VALUES ($1::uuid, $2, $3, 'active')
          ON CONFLICT (organization_id, auth_subject)
          DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = NOW()
        `,
        [row.organization_id, row.auth_subject, row.requested_role],
      );

      await client.query(
        `
          UPDATE user_identity
          SET home_organization_id = $2::uuid,
              updated_at = NOW()
          WHERE auth_subject = $1
        `,
        [row.auth_subject, row.organization_id],
      );

      await client.query(
        `
          INSERT INTO onboarding_state (auth_subject, organization_id, organization_confirmed_at, pending_join_request_id, updated_at)
          VALUES ($1, $2::uuid, NOW(), NULL, NOW())
          ON CONFLICT (auth_subject)
          DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            organization_confirmed_at = NOW(),
            pending_join_request_id = NULL,
            updated_at = NOW()
        `,
        [row.auth_subject, row.organization_id],
      );
    } else {
      await client.query(
        `
          UPDATE onboarding_state
          SET pending_join_request_id = NULL, updated_at = NOW()
          WHERE auth_subject = $1
        `,
        [row.auth_subject],
      );
      await client.query(
        `
          UPDATE organization_membership
          SET status = 'disabled', updated_at = NOW()
          WHERE organization_id = $1::uuid
            AND auth_subject = $2
            AND status = 'invited'
        `,
        [row.organization_id, row.auth_subject],
      );
    }

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: `organization.join_request.${nextStatus}`,
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        requestId: row.id,
        targetAuthSubject: row.auth_subject,
      },
    });

    await client.query("COMMIT");
    return jsonOk({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/organization/join-requests failed", error);
    return jsonError("Failed to review join request", 500);
  } finally {
    client.release();
  }
}
