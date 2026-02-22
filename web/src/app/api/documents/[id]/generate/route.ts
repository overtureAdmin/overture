import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import {
  BedrockGuardrailError,
  findPhiFindings,
  generateTextWithBedrock,
  getBedrockModelId,
} from "@/lib/bedrock";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type GenerateBody = {
  kind: "lmn" | "appeal" | "p2p";
  instructions?: string;
};

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<GenerateBody>(request);
  if (!body || !["lmn", "appeal", "p2p"].includes(body.kind)) {
    return jsonError("Missing required field: kind (lmn|appeal|p2p)", 422);
  }
  if (body.instructions?.trim()) {
    const instructionFindings = findPhiFindings(body.instructions.trim());
    if (instructionFindings.length > 0) {
      return jsonError("Input blocked by PHI guardrails", 422);
    }
  }

  const kind = body.kind;
  const { id } = await params;
  const db = getDbPool();
  const client = await db.connect();
  let actor: { tenantId: string; userId: string } | null = null;

  try {
    await client.query("BEGIN");
    actor = await ensureTenantAndUser(client, auth);

    const threadResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM thread
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
        LIMIT 1
      `,
      [id, actor.tenantId],
    );

    if (!threadResult.rows[0]?.id) {
      await client.query("ROLLBACK");
      return jsonError("Thread not found", 404);
    }

    const latestMessageResult = await client.query<{ content: string }>(
      `
        SELECT content
        FROM message
        WHERE tenant_id = $1::uuid
          AND thread_id = $2::uuid
          AND role = 'user'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [actor.tenantId, id],
    );
    const latestMessage = latestMessageResult.rows[0]?.content ?? "";
    const contextFindings = latestMessage ? findPhiFindings(latestMessage) : [];
    if (contextFindings.length > 0) {
      await client.query("ROLLBACK");
      return jsonError("Thread context blocked by PHI guardrails", 422);
    }

    const latestVersionResult = await client.query<{ max_version: number | null }>(
      `
        SELECT MAX(version) AS max_version
        FROM generated_document
        WHERE tenant_id = $1::uuid
          AND thread_id = $2::uuid
          AND kind = $3
      `,
      [actor.tenantId, id, kind],
    );
    const nextVersion = (latestVersionResult.rows[0]?.max_version ?? 0) + 1;

    const assistantDraft = await generateTextWithBedrock({
      systemPrompt:
        "You are Unity Appeals document assistant. Draft concise insurance appeal documents. PHI processing is disabled, so do not include personally identifying patient details.",
      userPrompt: [
        `Document kind: ${kind}`,
        `Thread ID: ${id}`,
        `User instructions: ${body.instructions?.trim() || "None provided."}`,
        `Latest user message context: ${latestMessage || "No prior thread messages."}`,
      ].join("\n"),
      temperature: 0.2,
    });

    const insertResult = await client.query<{
      id: string;
      created_at: string;
    }>(
      `
        INSERT INTO generated_document (tenant_id, thread_id, kind, version, content, citations, created_by_user_id)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, '[]'::jsonb, $6::uuid)
        RETURNING id, created_at
      `,
      [actor.tenantId, id, kind, nextVersion, assistantDraft, actor.userId],
    );

    const document = insertResult.rows[0];
    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "document.generate",
      entityType: "generated_document",
      entityId: document.id,
      metadata: {
        threadId: id,
        kind,
        version: nextVersion,
        modelId: getBedrockModelId(),
        phiProcessingEnabled: false,
      },
    });

    await client.query("COMMIT");
    return jsonOk(
      {
        threadId: id,
        documentId: document.id,
        kind,
        version: nextVersion,
        status: "draft_ready",
        createdAt: document.created_at,
      },
      201,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof BedrockGuardrailError && actor) {
      await insertAuditEvent(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "document.generate.blocked",
        entityType: "thread",
        entityId: id,
        metadata: {
          kind,
          modelId: getBedrockModelId(),
          guardrailCode: error.code,
          findings: error.findings,
          phiProcessingEnabled: false,
        },
      });
      return jsonError("Generated draft blocked by PHI guardrails", 422);
    }
    console.error("POST /api/documents/:id/generate failed", error);
    return jsonError("Failed to generate document", 500);
  } finally {
    client.release();
  }
}
