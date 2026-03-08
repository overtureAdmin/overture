import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { denyIfNoPermission, getPrimaryAccessGate } from "@/lib/access";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type CreateThreadBody = {
  patientCaseTitle: string;
};

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  const actor = await ensureTenantAndUser(db, auth);
  if (getPrimaryAccessGate(actor) !== "none") {
    return jsonError("Complete onboarding and billing setup first", 403);
  }
  const permissionDenied = denyIfNoPermission(actor, "workspace:view");
  if (permissionDenied) {
    return permissionDenied;
  }

  const result = await db.query<{
    id: string;
    title: string;
    updated_at: string;
  }>(
    `
      SELECT id, title, updated_at
      FROM thread
      WHERE tenant_id = $1::uuid
      ORDER BY updated_at DESC
      LIMIT 100
    `,
    [actor.tenantId],
  );

  return jsonOk({
    threads: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<CreateThreadBody>(request);
  if (!body || !body.patientCaseTitle?.trim()) {
    return jsonError("Missing required field: patientCaseTitle", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const actor = await ensureTenantAndUser(client, auth);
    if (getPrimaryAccessGate(actor) !== "none") {
      await client.query("ROLLBACK");
      return jsonError("Complete onboarding and billing setup first", 403);
    }
    const permissionDenied = denyIfNoPermission(actor, "case:create");
    if (permissionDenied) {
      await client.query("ROLLBACK");
      return permissionDenied;
    }
    const threadTitle = body.patientCaseTitle.trim();

    const caseResult = await client.query<{ id: string }>(
      `
        INSERT INTO patient_case (tenant_id, title, created_by_user_id)
        VALUES ($1::uuid, $2, $3::uuid)
        RETURNING id
      `,
      [actor.tenantId, threadTitle, actor.userId],
    );
    const patientCaseId = caseResult.rows[0].id;

    const threadResult = await client.query<{
      id: string;
      title: string;
      updated_at: string;
    }>(
      `
        INSERT INTO thread (tenant_id, patient_case_id, title, created_by_user_id)
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
        RETURNING id, title, updated_at
      `,
      [actor.tenantId, patientCaseId, threadTitle, actor.userId],
    );

    const thread = threadResult.rows[0];
    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "thread.create",
      entityType: "thread",
      entityId: thread.id,
      metadata: { patientCaseId },
    });

    await client.query("COMMIT");
    return jsonOk(
      {
        thread: {
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updated_at,
        },
      },
      201,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/threads failed", error);
    return jsonError("Failed to create thread", 500);
  } finally {
    client.release();
  }
}
