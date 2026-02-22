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

type ReviseBody = {
  revisionPrompt: string;
};

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<ReviseBody>(request);
  if (!body || !body.revisionPrompt?.trim()) {
    return jsonError("Missing required field: revisionPrompt", 422);
  }

  const revisionPrompt = body.revisionPrompt.trim();
  const promptFindings = findPhiFindings(revisionPrompt);
  if (promptFindings.length > 0) {
    return jsonError("Input blocked by PHI guardrails", 422);
  }
  const { id } = await params;
  const db = getDbPool();
  const client = await db.connect();
  let actor: { tenantId: string; userId: string } | null = null;
  let baseDocumentContext: {
    id: string;
    thread_id: string;
    kind: "lmn" | "appeal" | "p2p";
  } | null = null;
  try {
    await client.query("BEGIN");
    actor = await ensureTenantAndUser(client, auth);

    const baseDocumentResult = await client.query<{
      id: string;
      thread_id: string;
      kind: "lmn" | "appeal" | "p2p";
      version: number;
      content: string;
    }>(
      `
        SELECT id, thread_id, kind, version, content
        FROM generated_document
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
        LIMIT 1
      `,
      [id, actor.tenantId],
    );
    const baseDocument = baseDocumentResult.rows[0];
    if (!baseDocument) {
      await client.query("ROLLBACK");
      return jsonError("Document not found", 404);
    }
    baseDocumentContext = {
      id: baseDocument.id,
      thread_id: baseDocument.thread_id,
      kind: baseDocument.kind,
    };

    const revisedContent = await generateTextWithBedrock({
      systemPrompt:
        "You revise prior-authorization appeal drafts. Preserve medically relevant facts while improving clarity. PHI processing is disabled, so avoid patient-identifying details.",
      userPrompt: [
        `Document kind: ${baseDocument.kind}`,
        `Current content: ${baseDocument.content}`,
        `Revision request: ${revisionPrompt}`,
      ].join("\n\n"),
      temperature: 0.2,
    });

    const nextVersion = baseDocument.version + 1;
    const revisedResult = await client.query<{
      id: string;
      created_at: string;
    }>(
      `
        INSERT INTO generated_document (tenant_id, thread_id, kind, version, content, citations, created_by_user_id)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, '[]'::jsonb, $6::uuid)
        RETURNING id, created_at
      `,
      [
        actor.tenantId,
        baseDocument.thread_id,
        baseDocument.kind,
        nextVersion,
        revisedContent,
        actor.userId,
      ],
    );
    const revisedDocument = revisedResult.rows[0];

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "document.revise",
      entityType: "generated_document",
      entityId: revisedDocument.id,
      metadata: {
        previousDocumentId: baseDocument.id,
        threadId: baseDocument.thread_id,
        kind: baseDocument.kind,
        version: nextVersion,
        modelId: getBedrockModelId(),
        phiProcessingEnabled: false,
      },
    });

    await client.query("COMMIT");
    return jsonOk(
      {
        documentId: revisedDocument.id,
        previousDocumentId: baseDocument.id,
        status: "revised",
        version: nextVersion,
        updatedAt: revisedDocument.created_at,
      },
      201,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof BedrockGuardrailError && actor && baseDocumentContext) {
      await insertAuditEvent(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "document.revise.blocked",
        entityType: "generated_document",
        entityId: baseDocumentContext.id,
        metadata: {
          threadId: baseDocumentContext.thread_id,
          kind: baseDocumentContext.kind,
          modelId: getBedrockModelId(),
          guardrailCode: error.code,
          findings: error.findings,
          phiProcessingEnabled: false,
        },
      });
      return jsonError("Revised draft blocked by PHI guardrails", 422);
    }
    console.error("POST /api/documents/:id/revise failed", error);
    return jsonError("Failed to revise document", 500);
  } finally {
    client.release();
  }
}
