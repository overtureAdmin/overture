
import { deidentifyPromptText } from "../prompt-sanitization.ts";
import { evaluateRequiredChecklist, hasStructuredIntakeContext } from "../workflow-checklist.ts";
import { getWorkflowPolicy } from "../workflow-policy.ts";

type ChatMessageBody = {
  role: "user";
  content: string;
  mode?: "interactive" | "context_only";
};

type ChatActor = {
  tenantId: string;
  organizationId?: string;
  userId: string;
  role?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  baaAccepted?: boolean;
  onboardingCompleted?: boolean;
  organizationStatus?: "verified" | "pending_verification" | "suspended";
  organizationType?: "solo" | "enterprise";
  subscriptionStatus?: "trialing" | "active" | "past_due" | "canceled" | "none";
};

type SqlClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
};

type SqlPool = {
  connect: () => Promise<SqlClient>;
};

export type ChatMessageDeps = {
  getAuthContext: (request: Request) => Promise<{ tokenTenantId?: string | null; tenantId?: string; userSub: string; email: string | null } | null>;
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
    auth: { tokenTenantId?: string | null; tenantId?: string; userSub: string; email: string | null },
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
  resolvePromptContext?: (args: {
    db: SqlClient;
    organizationId: string;
    authSubject: string;
    fallbackSystemPrompt: string;
  }) => Promise<{ composedSystemPrompt: string }>;
};

export type ChatRouteParams = {
  params: Promise<{ threadId: string }>;
};

export function buildChatPrompt(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((message) => {
      const sanitized = deidentifyPromptText(message.content);
      return `${message.role.toUpperCase()}: ${sanitized.sanitizedText}`;
    })
    .join("\n\n");
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
    const mode = body.mode === "context_only" ? "context_only" : "interactive";
    const trimmedContent = body.content.trim();
    if (mode === "interactive") {
      const sanitizedInput = deidentifyPromptText(trimmedContent);
      const userPhiFindings = deps.findPhiFindings(sanitizedInput.sanitizedText);
      if (userPhiFindings.length > 0) {
        return deps.jsonError("Input blocked by PHI guardrails", 422);
      }
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

      if (mode === "context_only") {
        const workflowPolicy = await getWorkflowPolicy(client);
        const hasStructuredContext = hasStructuredIntakeContext(trimmedContent);
        const { missingRequired } = evaluateRequiredChecklist({
          policy: workflowPolicy,
          checklistContext: trimmedContent,
          hasStructuredContext,
        });
        let assistantMessageId: string | null = null;
        let assistantReply: string | null = null;
        if (workflowPolicy.requireChecklistCompletion && (!hasStructuredContext || missingRequired.length > 0)) {
          const blockedToken = missingRequired.length > 0 ? `\n\n[[CHECKLIST_BLOCKED|${missingRequired.join("|")}]]` : "";
          assistantReply = !hasStructuredContext
            ? `I saved your request. To generate a draft, add structured intake details in Details or send them here in chat as labeled fields (Patient name, DOB, Sex, Diagnosis, Requested/denied treatment, Denial reason, Payer name, Member ID).${blockedToken}`
            : `I saved your request. I still need required intake details before drafting. Add them in Details or send them here in chat.${blockedToken}`;
          const assistantInsert = await client.query<{ id: string }>(
            `
              INSERT INTO message (tenant_id, thread_id, role, content, citations)
              VALUES ($1::uuid, $2::uuid, 'assistant', $3, '[]'::jsonb)
              RETURNING id
            `,
            [actor.tenantId, threadId, assistantReply],
          );
          assistantMessageId = assistantInsert.rows[0]?.id ?? null;
        }

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
          action: "message.create.context_only",
          entityType: "thread",
          entityId: threadId,
          metadata: {
            userMessageId: userMessageResult.rows[0].id,
            phiProcessingEnabled: false,
            modelInvoked: false,
            assistantGuidanceEmitted: Boolean(assistantMessageId),
            missingRequiredCount: missingRequired.length,
          },
        });
        await client.query("COMMIT");
        return deps.jsonOk(
          {
            threadId,
            userMessageId: userMessageResult.rows[0].id,
            assistantMessageId,
            assistantReply,
            citations: [],
          },
          201,
        );
      }

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

      const baseSystemPrompt =
        "You are Overture assistant. Help draft prior-authorization appeals clearly and conservatively. PHI processing is disabled, so avoid patient-identifying details.";
      const promptContext = deps.resolvePromptContext
        ? await deps.resolvePromptContext({
            db: client,
            organizationId: actor.organizationId ?? actor.tenantId,
            authSubject: auth.userSub,
            fallbackSystemPrompt: baseSystemPrompt,
          })
        : { composedSystemPrompt: baseSystemPrompt };

      const assistantReply = await deps.generateTextWithBedrock({
        systemPrompt: promptContext.composedSystemPrompt,
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
