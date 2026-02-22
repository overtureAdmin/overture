type GenerateBody = {
  kind: "lmn" | "appeal" | "p2p";
  instructions?: string;
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

export type DocumentGenerateDeps = {
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

export type DocumentGenerateRouteParams = {
  params: Promise<{ id: string }>;
};

export function createDocumentGenerateHandler(deps: DocumentGenerateDeps) {
  return async function handleDocumentGenerate(request: Request, { params }: DocumentGenerateRouteParams) {
    const auth = await deps.getAuthContext(request);
    if (!auth) {
      return deps.authRequiredResponse();
    }

    const body = await deps.parseJsonBody<GenerateBody>(request);
    if (!body || !["lmn", "appeal", "p2p"].includes(body.kind)) {
      return deps.jsonError("Missing required field: kind (lmn|appeal|p2p)", 422);
    }
    if (body.instructions?.trim()) {
      const instructionFindings = deps.findPhiFindings(body.instructions.trim());
      if (instructionFindings.length > 0) {
        return deps.jsonError("Input blocked by PHI guardrails", 422);
      }
    }

    const kind = body.kind;
    const { id } = await params;
    const db = deps.getDbPool();
    const client = await db.connect();
    let actor: Actor | null = null;
    try {
      await client.query("BEGIN");
      actor = await deps.ensureTenantAndUser(client, auth);

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
        return deps.jsonError("Thread not found", 404);
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
      const contextFindings = latestMessage ? deps.findPhiFindings(latestMessage) : [];
      if (contextFindings.length > 0) {
        await client.query("ROLLBACK");
        return deps.jsonError("Thread context blocked by PHI guardrails", 422);
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

      const assistantDraft = await deps.generateTextWithBedrock({
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

      const insertResult = await client.query<{ id: string; created_at: string }>(
        `
          INSERT INTO generated_document (tenant_id, thread_id, kind, version, content, citations, created_by_user_id)
          VALUES ($1::uuid, $2::uuid, $3, $4, $5, '[]'::jsonb, $6::uuid)
          RETURNING id, created_at
        `,
        [actor.tenantId, id, kind, nextVersion, assistantDraft, actor.userId],
      );
      const document = insertResult.rows[0];

      await deps.insertAuditEvent(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "document.generate",
        entityType: "generated_document",
        entityId: document.id,
        metadata: {
          threadId: id,
          kind,
          version: nextVersion,
          modelId: deps.getBedrockModelId(),
          phiProcessingEnabled: false,
        },
      });

      await client.query("COMMIT");
      return deps.jsonOk(
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
      if (deps.isBedrockGuardrailError(error) && actor) {
        await deps.insertAuditEvent(client, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "document.generate.blocked",
          entityType: "thread",
          entityId: id,
          metadata: {
            kind,
            modelId: deps.getBedrockModelId(),
            guardrailCode: error.code,
            findings: error.findings,
            phiProcessingEnabled: false,
          },
        });
        return deps.jsonError("Generated draft blocked by PHI guardrails", 422);
      }
      return deps.jsonError("Failed to generate document", 500);
    } finally {
      client.release();
    }
  };
}
