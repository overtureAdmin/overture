import { getDbPool } from "@/lib/db";
import { optionalEnv } from "@/lib/env";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { findPhiFindings } from "@/lib/bedrock";

type CallbackBody = {
  batchId?: string;
  status?: "running" | "completed" | "failed" | "blocked" | "canceled";
  output?: unknown;
  errorMessage?: string;
  n8nExecutionId?: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const sharedSecret = optionalEnv("N8N_CALLBACK_SHARED_SECRET");
  const received = request.headers.get("x-unity-workflow-token");
  if (!sharedSecret || !received || received !== sharedSecret) {
    return jsonError("Forbidden", 403);
  }

  const body = await parseJsonBody<CallbackBody>(request);
  const batchId = body?.batchId?.trim() ?? "";
  const nextStatus = body?.status ?? "completed";
  if (!batchId || !isUuid(batchId)) {
    return jsonError("Valid batchId is required", 422);
  }

  const serializedOutput = JSON.stringify(body?.output ?? {});
  const outputFindings = findPhiFindings(typeof body?.output === "string" ? body.output : serializedOutput);
  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE workflow_batch
        SET
          status = $2,
          output_payload = $3::jsonb,
          n8n_execution_id = COALESCE($4, n8n_execution_id),
          error_message = CASE WHEN $2 IN ('failed', 'blocked', 'canceled') THEN $5 ELSE NULL END,
          started_at = COALESCE(started_at, NOW()),
          completed_at = CASE WHEN $2 IN ('completed', 'failed', 'blocked', 'canceled') THEN NOW() ELSE NULL END
        WHERE id = $1::uuid
      `,
      [batchId, nextStatus, serializedOutput, body?.n8nExecutionId ?? null, body?.errorMessage?.slice(0, 1000) ?? null],
    );
    await client.query(
      `
        INSERT INTO workflow_batch_audit (batch_id, check_type, status, findings, metadata)
        VALUES ($1::uuid, 'post_dispatch_phi_scan', $2, $3::jsonb, $4::jsonb)
      `,
      [
        batchId,
        outputFindings.length > 0 ? "warn" : "pass",
        JSON.stringify(outputFindings),
        JSON.stringify({
          callbackStatus: nextStatus,
          n8nExecutionId: body?.n8nExecutionId ?? null,
        }),
      ],
    );
    await client.query("COMMIT");
    return jsonOk({ updated: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/internal/workflow/batches/callback failed", error);
    return jsonError("Failed to update batch callback", 500);
  } finally {
    client.release();
  }
}
