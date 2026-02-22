type ChatMessageBody = {
  role: "user";
  content: string;
};

type ChatActor = {
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

export type ChatMessageDeps = {
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
  ) => Promise<ChatActor>;
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

export type ChatRouteParams = {
  params: Promise<{ threadId: string }>;
};

export function buildChatPrompt(messages: Array<{ role: string; content: string }>): string {
  return messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
}

export function createChatMessageHandler(deps: ChatMessageDeps) {
  return async function handleChatMessage(request: Request, { params }: ChatRouteParams) {
    const auth = await deps.getAuthContext(request);
    if (!auth) {
      return deps.authRequiredResponse();
    }

    const body = await deps.parseJsonBody<ChatMessageBody>(request);
    if (!body || body.role !== "user" || !body.content?.trim()) {
      return deps.jsonError("Missing required fields: role='user', content", 422);
    }
    const trimmedContent = body.content.trim();
    const userPhiFindings = deps.findPhiFindings(trimmedContent);
    if (userPhiFindings.length > 0) {
      return deps.jsonError("Input blocked by PHI guardrails", 422);
    }

    const db = deps.getDbPool();
    const client = await db.connect();
    const { threadId } = await params;
    let actor: ChatActor | null = null;
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
        [threadId, actor.tenantId],
      );
      if (!threadResult.rows[0]?.id) {
        await client.query("ROLLBACK");
        return deps.jsonError("Thread not found", 404);
      }

      const userMessageResult = await client.query<{ id: string }>(
        `
          INSERT INTO message (tenant_id, thread_id, user_id, role, content)
          VALUES ($1::uuid, $2::uuid, $3::uuid, 'user', $4)
          RETURNING id
        `,
        [actor.tenantId, threadId, actor.userId, trimmedContent],
      );

      const promptMessagesResult = await client.query<{ role: string; content: string }>(
        `
          SELECT role, content
          FROM message
          WHERE tenant_id = $1::uuid
            AND thread_id = $2::uuid
          ORDER BY created_at DESC
          LIMIT 20
        `,
        [actor.tenantId, threadId],
      );

      const assistantReply = await deps.generateTextWithBedrock({
        systemPrompt:
          "You are Unity Appeals assistant. Help draft prior-authorization appeals clearly and conservatively. PHI processing is disabled, so avoid patient-identifying details.",
        userPrompt: buildChatPrompt([...promptMessagesResult.rows].reverse()),
        temperature: 0.2,
      });

      const assistantMessageResult = await client.query<{ id: string }>(
        `
          INSERT INTO message (tenant_id, thread_id, role, content, citations)
          VALUES ($1::uuid, $2::uuid, 'assistant', $3, '[]'::jsonb)
          RETURNING id
        `,
        [actor.tenantId, threadId, assistantReply],
      );

      await client.query(
        `
          UPDATE thread
          SET updated_at = NOW()
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
        `,
        [threadId, actor.tenantId],
      );

      await deps.insertAuditEvent(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "message.create",
        entityType: "thread",
        entityId: threadId,
        metadata: {
          userMessageId: userMessageResult.rows[0].id,
          assistantMessageId: assistantMessageResult.rows[0].id,
          modelId: deps.getBedrockModelId(),
          phiProcessingEnabled: false,
        },
      });

      await client.query("COMMIT");
      return deps.jsonOk(
        {
          threadId,
          userMessageId: userMessageResult.rows[0].id,
          assistantMessageId: assistantMessageResult.rows[0].id,
          assistantReply,
          citations: [],
        },
        201,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      if (deps.isBedrockGuardrailError(error) && actor) {
        await deps.insertAuditEvent(client, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "message.create.blocked",
          entityType: "thread",
          entityId: threadId,
          metadata: {
            modelId: deps.getBedrockModelId(),
            guardrailCode: error.code,
            findings: error.findings,
            phiProcessingEnabled: false,
          },
        });
        return deps.jsonError("Model output blocked by PHI guardrails", 422);
      }
      return deps.jsonError("Failed to create message", 500);
    } finally {
      client.release();
    }
  };
}
