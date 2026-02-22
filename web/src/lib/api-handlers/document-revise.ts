type ReviseBody = {
  revisionPrompt: string;
};

type Actor = {
  tenantId: string;
  userId: string;
};

type SqlClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
};

type SqlPool = {
  connect: () => Promise<SqlClient>;
};

export type DocumentReviseDeps = {
  getAuthContext: (request: Request) => Promise<{ tenantId: string; userSub: string; email: string | null } | null>;
  authRequiredResponse: () => Response;
  parseJsonBody: <T>(request: Request) => Promise<T | null>;
  jsonError: (message: string, status?: number) => Response;
  jsonOk: (payload: unknown, status?: number) => Response;
  findPhiFindings: (content: string) => string[];
  generateTextWithBedrock: (params: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
  }) => Promise<string>;
  getBedrockModelId: () => string;
  isBedrockGuardrailError: (error: unknown) => error is { code: string; findings: string[] };
  getDbPool: () => SqlPool;
  ensureTenantAndUser: (
    db: SqlClient,
    auth: { tenantId: string; userSub: string; email: string | null },
  ) => Promise<Actor>;
  insertAuditEvent: (
    db: SqlClient,
    params: {
      tenantId: string;
      actorUserId: string;
      action: string;
      entityType: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<void>;
};

export type DocumentReviseRouteParams = {
  params: Promise<{ id: string }>;
};

export function createDocumentReviseHandler(deps: DocumentReviseDeps) {
  return async function handleDocumentRevise(request: Request, { params }: DocumentReviseRouteParams) {
    const auth = await deps.getAuthContext(request);
    if (!auth) {
      return deps.authRequiredResponse();
    }

    const body = await deps.parseJsonBody<ReviseBody>(request);
    if (!body || !body.revisionPrompt?.trim()) {
      return deps.jsonError("Missing required field: revisionPrompt", 422);
    }

    const revisionPrompt = body.revisionPrompt.trim();
    const promptFindings = deps.findPhiFindings(revisionPrompt);
    if (promptFindings.length > 0) {
      return deps.jsonError("Input blocked by PHI guardrails", 422);
    }

    const { id } = await params;
    const db = deps.getDbPool();
    const client = await db.connect();
    let actor: Actor | null = null;
    let baseDocumentContext: {
      id: string;
      thread_id: string;
      kind: "lmn" | "appeal" | "p2p";
    } | null = null;
    try {
      await client.query("BEGIN");
      actor = await deps.ensureTenantAndUser(client, auth);

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
        return deps.jsonError("Document not found", 404);
      }
      baseDocumentContext = {
        id: baseDocument.id,
        thread_id: baseDocument.thread_id,
        kind: baseDocument.kind,
      };

      const revisedContent = await deps.generateTextWithBedrock({
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

      await deps.insertAuditEvent(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "document.revise",
        entityType: "generated_document",
        entityId: revisedDocument.id,
        metadata: {
          outcome: "success",
          threadId: baseDocument.thread_id,
          documentId: revisedDocument.id,
          previousDocumentId: baseDocument.id,
          kind: baseDocument.kind,
          version: nextVersion,
          modelId: deps.getBedrockModelId(),
          phiProcessingEnabled: false,
        },
      });

      await client.query("COMMIT");
      return deps.jsonOk(
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
      if (deps.isBedrockGuardrailError(error) && actor && baseDocumentContext) {
        await deps.insertAuditEvent(client, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "document.revise.blocked",
          entityType: "generated_document",
          entityId: baseDocumentContext.id,
          metadata: {
            outcome: "blocked",
            threadId: baseDocumentContext.thread_id,
            documentId: baseDocumentContext.id,
            kind: baseDocumentContext.kind,
            modelId: deps.getBedrockModelId(),
            guardrailCode: error.code,
            findings: error.findings,
            phiProcessingEnabled: false,
          },
        });
        return deps.jsonError("Revised draft blocked by PHI guardrails", 422);
      }
      return deps.jsonError("Failed to revise document", 500);
    } finally {
      client.release();
    }
  };
}
