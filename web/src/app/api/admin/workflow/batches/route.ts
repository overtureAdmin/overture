import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { optionalEnv } from "@/lib/env";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";
import { buildBatchPayload, getWorkflowOrchestrationPolicy, type WorkflowBatchSource } from "@/lib/workflow-orchestration";

type CreateBatchBody = {
  organizationId?: string;
  authSubject?: string;
  threadId?: string | null;
  documentId?: string | null;
  source?: WorkflowBatchSource;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function sendToN8n(params: {
  webhookUrl: string;
  timeoutMs: number;
  callbackToken: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; responseStatus?: number; executionId?: string; message?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await fetch(params.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-unity-workflow-token": params.callbackToken,
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, responseStatus: response.status, message: text.slice(0, 500) };
    }
    try {
      const parsed = JSON.parse(text) as { executionId?: string; message?: string };
      return { ok: true, responseStatus: response.status, executionId: parsed.executionId, message: parsed.message };
    } catch {
      return { ok: true, responseStatus: response.status, message: text.slice(0, 500) };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "dispatch failed" };
  } finally {
    clearTimeout(timeout);
  }
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
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;
  if (organizationId && !isUuid(organizationId)) {
    return jsonError("Invalid organizationId", 422);
  }

  const db = getDbPool();
  try {
    const result = organizationId
      ? await db.query<{
          id: string;
          organization_id: string;
          thread_id: string | null;
          document_id: string | null;
          requested_by_subject: string | null;
          source: string;
          status: string;
          n8n_execution_id: string | null;
          error_message: string | null;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
        }>(
          `
            SELECT
              id, organization_id, thread_id, document_id, requested_by_subject, source, status,
              n8n_execution_id, error_message, created_at, started_at, completed_at
            FROM workflow_batch
            WHERE organization_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT $2
          `,
          [organizationId, limit],
        )
      : await db.query<{
          id: string;
          organization_id: string;
          thread_id: string | null;
          document_id: string | null;
          requested_by_subject: string | null;
          source: string;
          status: string;
          n8n_execution_id: string | null;
          error_message: string | null;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
        }>(
          `
            SELECT
              id, organization_id, thread_id, document_id, requested_by_subject, source, status,
              n8n_execution_id, error_message, created_at, started_at, completed_at
            FROM workflow_batch
            ORDER BY created_at DESC
            LIMIT $1
          `,
          [limit],
        );

    return jsonOk({
      batches: result.rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        threadId: row.thread_id,
        documentId: row.document_id,
        requestedBySubject: row.requested_by_subject,
        source: row.source,
        status: row.status,
        n8nExecutionId: row.n8n_execution_id,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      })),
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42P01") {
      return jsonOk({ batches: [] as unknown[] });
    }
    console.error("GET /api/admin/workflow/batches failed", error);
    return jsonError("Failed to load workflow batches", 500);
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

  const body = await parseJsonBody<CreateBatchBody>(request);
  const organizationId = body?.organizationId?.trim() ?? "";
  const authSubject = body?.authSubject?.trim() ?? auth.userSub;
  const threadId = body?.threadId?.trim() || null;
  const documentId = body?.documentId?.trim() || null;
  const source: WorkflowBatchSource = body?.source ?? "manual";

  if (!organizationId || !isUuid(organizationId)) {
    return jsonError("Valid organizationId is required", 422);
  }
  if (threadId && !isUuid(threadId)) {
    return jsonError("Invalid threadId", 422);
  }
  if (documentId && !isUuid(documentId)) {
    return jsonError("Invalid documentId", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const policy = await getWorkflowOrchestrationPolicy(client);
    const payload = await buildBatchPayload({
      db: client,
      organizationId,
      authSubject,
      threadId,
      documentId,
      source,
    });

    const insertBatch = await client.query<{ id: string }>(
      `
        INSERT INTO workflow_batch (
          organization_id,
          thread_id,
          document_id,
          requested_by_subject,
          source,
          status,
          input_payload,
          prompt_snapshot
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          $5,
          'queued',
          $6::jsonb,
          $7
        )
        RETURNING id
      `,
      [organizationId, threadId, documentId, authSubject, source, JSON.stringify(payload.inputPayload), payload.promptSnapshot],
    );
    const batchId = insertBatch.rows[0]?.id;
    if (!batchId) {
      throw new Error("Batch insert failed");
    }

    await client.query(
      `
        INSERT INTO workflow_batch_audit (batch_id, check_type, status, findings, metadata)
        VALUES ($1::uuid, 'pre_dispatch_phi_scan', $2, $3::jsonb, $4::jsonb)
      `,
      [
        batchId,
        payload.phiAuditFindings.length > 0 ? "warn" : "pass",
        JSON.stringify(payload.phiAuditFindings),
        JSON.stringify({ removedDirectIdentifiers: payload.redactionApplied }),
      ],
    );

    let dispatch = { attempted: false, sent: false, message: "n8n dispatch disabled", executionId: null as string | null };
    if (policy.n8nEnabled && policy.dispatchMode !== "disabled" && policy.webhookUrl) {
      const callbackToken = optionalEnv("N8N_CALLBACK_SHARED_SECRET") ?? "";
      if (!callbackToken) {
        dispatch = { attempted: false, sent: false, message: "N8N callback token missing in runtime env", executionId: null };
      } else {
        dispatch = { attempted: true, sent: false, message: "", executionId: null };
        const response = await sendToN8n({
          webhookUrl: policy.webhookUrl,
          timeoutMs: policy.timeoutMs,
          callbackToken,
          payload: {
            batchId,
            organizationId,
            authSubject,
            source,
            promptSnapshot: payload.promptSnapshot,
            input: payload.inputPayload,
          },
        });
        if (response.ok) {
          dispatch = { attempted: true, sent: true, message: response.message ?? "Dispatched", executionId: response.executionId ?? null };
          await client.query(
            `
              UPDATE workflow_batch
              SET status = 'running',
                  started_at = NOW(),
                  n8n_execution_id = COALESCE($2, n8n_execution_id)
              WHERE id = $1::uuid
            `,
            [batchId, dispatch.executionId],
          );
        } else {
          dispatch = { attempted: true, sent: false, message: response.message ?? "Dispatch failed", executionId: null };
          await client.query(
            `
              UPDATE workflow_batch
              SET status = 'failed',
                  error_message = $2,
                  completed_at = NOW()
              WHERE id = $1::uuid
            `,
            [batchId, dispatch.message.slice(0, 1000)],
          );
        }
      }
    }

    await client.query(
      `
        INSERT INTO super_admin_action_log (actor_subject, action, organization_id, target_auth_subject, metadata)
        VALUES ($1, 'admin.workflow_batch_dispatch', $2::uuid, $3, $4::jsonb)
      `,
      [
        auth.userSub,
        organizationId,
        authSubject,
        JSON.stringify({
          batchId,
          source,
          dispatchedToN8n: dispatch.sent,
          dispatchAttempted: dispatch.attempted,
          dispatchMessage: dispatch.message,
        }),
      ],
    );
    await client.query("COMMIT");

    return jsonOk(
      {
        batchId,
        status: dispatch.sent ? "running" : "queued",
        dispatch,
      },
      201,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/workflow/batches failed", error);
    return jsonError("Failed to dispatch workflow batch", 500);
  } finally {
    client.release();
  }
}
