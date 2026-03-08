import { deidentifyPromptText } from "@/lib/prompt-sanitization";
import { findPhiFindings } from "@/lib/bedrock";
import { resolveLlmPromptContext } from "@/lib/llm-settings";

type SqlClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type WorkflowOrchestrationPolicy = {
  version: number;
  n8nEnabled: boolean;
  dispatchMode: "disabled" | "shadow" | "active";
  webhookUrl: string;
  callbackTokenRequired: boolean;
  timeoutMs: number;
  redactPhiBeforeDispatch: boolean;
};

export type WorkflowBatchSource = "manual" | "document_generate" | "chat";
export type WorkflowBatchStatus = "queued" | "running" | "completed" | "failed" | "blocked" | "canceled";

function defaultPolicy(): WorkflowOrchestrationPolicy {
  return {
    version: 1,
    n8nEnabled: false,
    dispatchMode: "disabled",
    webhookUrl: "",
    callbackTokenRequired: true,
    timeoutMs: 8000,
    redactPhiBeforeDispatch: true,
  };
}

function cleanText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim().slice(0, maxLen);
}

function cleanBoolean(input: unknown, fallback: boolean): boolean {
  if (typeof input !== "boolean") {
    return fallback;
  }
  return input;
}

export function normalizeWorkflowOrchestrationPolicy(input: unknown): WorkflowOrchestrationPolicy {
  const base = defaultPolicy();
  const source = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const timeoutRaw = Number(source.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(1000, Math.min(30000, Math.trunc(timeoutRaw))) : base.timeoutMs;
  const dispatchMode = source.dispatchMode === "shadow" || source.dispatchMode === "active" ? source.dispatchMode : "disabled";
  const webhookUrl = cleanText(source.webhookUrl, 2000);
  const n8nEnabled = cleanBoolean(source.n8nEnabled, base.n8nEnabled) && webhookUrl.length > 0 && dispatchMode !== "disabled";

  return {
    version: 1,
    n8nEnabled,
    dispatchMode,
    webhookUrl,
    callbackTokenRequired: cleanBoolean(source.callbackTokenRequired, base.callbackTokenRequired),
    timeoutMs,
    redactPhiBeforeDispatch: cleanBoolean(source.redactPhiBeforeDispatch, base.redactPhiBeforeDispatch),
  };
}

function isFallbackError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42501";
}

export async function getWorkflowOrchestrationPolicy(db: SqlClient): Promise<WorkflowOrchestrationPolicy> {
  try {
    const result = await db.query<{ policy: unknown }>(
      `
        SELECT policy
        FROM admin_workflow_orchestration
        WHERE id = 1
        LIMIT 1
      `,
    );
    return normalizeWorkflowOrchestrationPolicy(result.rows[0]?.policy ?? defaultPolicy());
  } catch (error) {
    if (isFallbackError(error)) {
      return defaultPolicy();
    }
    throw error;
  }
}

export async function saveWorkflowOrchestrationPolicy(params: {
  db: SqlClient;
  actorSubject: string;
  policy: WorkflowOrchestrationPolicy;
}): Promise<void> {
  await params.db.query(
    `
      INSERT INTO admin_workflow_orchestration (id, policy, updated_by_subject, updated_at)
      VALUES (1, $1::jsonb, $2, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        policy = EXCLUDED.policy,
        updated_by_subject = EXCLUDED.updated_by_subject,
        updated_at = NOW()
    `,
    [JSON.stringify(params.policy), params.actorSubject],
  );
}

export async function buildBatchPayload(params: {
  db: SqlClient;
  organizationId: string;
  authSubject: string;
  threadId: string | null;
  documentId: string | null;
  source: WorkflowBatchSource;
}): Promise<{
  promptSnapshot: string;
  inputPayload: Record<string, unknown>;
  phiAuditFindings: string[];
  redactionApplied: boolean;
}> {
  const basePrompt = "You are Overture orchestration context builder.";
  const promptContext = await resolveLlmPromptContext({
    db: params.db,
    organizationId: params.organizationId,
    authSubject: params.authSubject,
    fallbackSystemPrompt: basePrompt,
  });

  const messagesResult = params.threadId
    ? await params.db.query<{ role: string; content: string; created_at: string }>(
        `
          SELECT role, content, created_at
          FROM message
          WHERE thread_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 25
        `,
        [params.threadId],
      )
    : { rows: [] as Array<{ role: string; content: string; created_at: string }> };
  const latestUserContent = messagesResult.rows.find((row) => row.role === "user")?.content ?? "";
  const recentUserContext = messagesResult.rows
    .filter((row) => row.role === "user")
    .reverse()
    .map((row) => row.content.trim())
    .filter(Boolean)
    .join("\n\n");

  const deidentified = deidentifyPromptText(recentUserContext || latestUserContent);
  const phiFindings = findPhiFindings(deidentified.sanitizedText);

  const documentResult = params.documentId
    ? await params.db.query<{ id: string; kind: string; version: number; content: string }>(
        `
          SELECT id, kind, version, content
          FROM generated_document
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
          LIMIT 1
        `,
        [params.documentId, params.organizationId],
      )
    : { rows: [] as Array<{ id: string; kind: string; version: number; content: string }> };

  return {
    promptSnapshot: promptContext.composedSystemPrompt,
    phiAuditFindings: phiFindings,
    redactionApplied: deidentified.removedDirectIdentifiers,
    inputPayload: {
      source: params.source,
      organizationId: params.organizationId,
      authSubject: params.authSubject,
      threadId: params.threadId,
      documentId: params.documentId,
      deidentifiedContext: deidentified.sanitizedText,
      ageDerivation: deidentified.ageDerivation,
      latestUserContent,
      document:
        documentResult.rows[0] == null
          ? null
          : {
              id: documentResult.rows[0].id,
              kind: documentResult.rows[0].kind,
              version: documentResult.rows[0].version,
              content: documentResult.rows[0].content,
            },
      references: promptContext.references,
      promptLayers: {
        master: promptContext.masterPrompt,
        organization: null,
        user: promptContext.userPrompt,
      },
    },
  };
}
