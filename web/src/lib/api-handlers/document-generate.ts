
import { deidentifyPromptText } from "../prompt-sanitization.ts";
import { getDefaultWorkflowPolicy, type WorkflowPolicy } from "../workflow-policy.ts";
import { evaluateRequiredChecklist, hasStructuredIntakeContext } from "../workflow-checklist.ts";
import {
  collectDraftPhiContext,
  hydrateDraftPlaceholders,
  mergeDraftPhiContext,
  normalizeToCanonicalPlaceholders,
  placeholderInstructionBlock,
} from "../document-placeholders.ts";

type GenerateBody = {
  kind: "lmn" | "appeal" | "p2p";
  instructions?: string;
  allowIncomplete?: boolean;
};

type Actor = {
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

type WorkflowStageKey = "intake_review" | "evidence_plan" | "draft_plan";
type WorkflowStageStatus = "pending" | "blocked" | "ready" | "complete";

async function upsertWorkflowStage(
  db: SqlClient,
  params: {
    tenantId: string;
    threadId: string;
    stageKey: WorkflowStageKey;
    status: WorkflowStageStatus;
    summary: string;
    metadata?: Record<string, unknown>;
    updatedByUserId?: string;
  },
) {
  await db.query(
    `
      INSERT INTO thread_workflow_stage (
        tenant_id,
        thread_id,
        stage_key,
        status,
        summary,
        metadata,
        updated_by_user_id
      )
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, COALESCE($6::jsonb, '{}'::jsonb), $7::uuid)
      ON CONFLICT (thread_id, stage_key)
      DO UPDATE SET
        status = EXCLUDED.status,
        summary = EXCLUDED.summary,
        metadata = EXCLUDED.metadata,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = NOW()
    `,
    [
      params.tenantId,
      params.threadId,
      params.stageKey,
      params.status,
      params.summary,
      JSON.stringify(params.metadata ?? {}),
      params.updatedByUserId ?? null,
    ],
  );
}

export type DocumentGenerateDeps = {
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
  resolvePromptContext?: (args: {
    db: SqlClient;
    organizationId: string;
    authSubject: string;
    fallbackSystemPrompt: string;
  }) => Promise<{ composedSystemPrompt: string }>;
  resolveWorkflowPolicy?: (db: SqlClient) => Promise<WorkflowPolicy>;
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
    const sanitizedInstructions = body.instructions?.trim() ? deidentifyPromptText(body.instructions.trim()) : null;
    if (sanitizedInstructions) {
      const instructionFindings = deps.findPhiFindings(sanitizedInstructions.sanitizedText);
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

      const recentUserMessagesResult = await client.query<{ content: string }>(
        `
          SELECT content
          FROM message
          WHERE tenant_id = $1::uuid
            AND thread_id = $2::uuid
            AND role = 'user'
          ORDER BY created_at DESC
          LIMIT 25
        `,
        [actor.tenantId, id],
      );
      const latestMessage = recentUserMessagesResult.rows[0]?.content ?? "";
      const fullUserContext = recentUserMessagesResult.rows
        .map((row) => row.content?.trim() ?? "")
        .filter(Boolean)
        .reverse()
        .join("\n\n");
      const sanitizedContext = fullUserContext ? deidentifyPromptText(fullUserContext) : null;
      const contextFindings = sanitizedContext ? deps.findPhiFindings(sanitizedContext.sanitizedText) : [];
      if (contextFindings.length > 0) {
        await client.query("ROLLBACK");
        return deps.jsonError("Thread context blocked by PHI guardrails", 422);
      }

      const hasStructuredContext = hasStructuredIntakeContext(fullUserContext);
      const checklistContext = [fullUserContext, body.instructions?.trim() ?? ""].filter(Boolean).join("\n\n");
      const workflowPolicy = deps.resolveWorkflowPolicy ? await deps.resolveWorkflowPolicy(client) : getDefaultWorkflowPolicy();
      const { missingRequired } = evaluateRequiredChecklist({
        policy: workflowPolicy,
        checklistContext,
        hasStructuredContext,
      });
      const allowIncomplete = body.allowIncomplete === true;
      const canForceOverride =
        workflowPolicy.allowOwnerAdminOverride && (actor.role === "org_owner" || actor.role === "org_admin");
      const shouldBlockForChecklist = workflowPolicy.requireChecklistCompletion;
      if (shouldBlockForChecklist && missingRequired.length > 0 && !(allowIncomplete && canForceOverride)) {
        await upsertWorkflowStage(client, {
          tenantId: actor.tenantId,
          threadId: id,
          stageKey: "intake_review",
          status: "blocked",
          summary: workflowPolicy.stageSummaries.intakeBlocked,
          metadata: { missingRequired, policyVersion: workflowPolicy.version },
          updatedByUserId: actor.userId,
        });
        await upsertWorkflowStage(client, {
          tenantId: actor.tenantId,
          threadId: id,
          stageKey: "evidence_plan",
          status: "pending",
          summary: workflowPolicy.stageSummaries.evidencePending,
          metadata: { blockedBy: "intake_review", missingRequiredCount: missingRequired.length, policyVersion: workflowPolicy.version },
          updatedByUserId: actor.userId,
        });
        await upsertWorkflowStage(client, {
          tenantId: actor.tenantId,
          threadId: id,
          stageKey: "draft_plan",
          status: "blocked",
          summary: workflowPolicy.stageSummaries.draftBlocked,
          metadata: { missingRequired, policyVersion: workflowPolicy.version },
          updatedByUserId: actor.userId,
        });
        const blockedToken = `[[CHECKLIST_BLOCKED|${missingRequired.join("|")}]]`;
        await client.query(
          `
            INSERT INTO message (tenant_id, thread_id, role, content, citations)
            VALUES ($1::uuid, $2::uuid, 'assistant', $3, '[]'::jsonb)
          `,
          [
            actor.tenantId,
            id,
            `I need the required checklist details before drafting. Fill the missing items listed below or use force generate if your role allows.\n\n${blockedToken}`,
          ],
        );
        await client.query(
          `
            UPDATE thread
            SET updated_at = NOW()
            WHERE id = $1::uuid
              AND tenant_id = $2::uuid
          `,
          [id, actor.tenantId],
        );
        await deps.insertAuditEvent(client, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "document.generate.blocked_intake",
          entityType: "thread",
          entityId: id,
          metadata: {
            outcome: "blocked",
            kind,
            missingRequired,
            checklistMissingCount: missingRequired.length,
            checklistOverrideAllowed: canForceOverride,
            workflowPolicyVersion: workflowPolicy.version,
          },
        });
        await client.query("COMMIT");
        return deps.jsonError(
          `Missing required checklist items: ${missingRequired.join(", ")}. MISSING_REQUIRED::${missingRequired.join("|")}`,
          422,
        );
      }

      await upsertWorkflowStage(client, {
        tenantId: actor.tenantId,
        threadId: id,
        stageKey: "intake_review",
        status: missingRequired.length > 0 ? "blocked" : "ready",
        summary:
          missingRequired.length > 0
            ? "Intake is incomplete but generation override was used."
            : workflowPolicy.stageSummaries.intakeReady,
        metadata: {
          missingRequired,
          checklistOverrideUsed: allowIncomplete && missingRequired.length > 0,
          policyVersion: workflowPolicy.version,
        },
        updatedByUserId: actor.userId,
      });
      await upsertWorkflowStage(client, {
        tenantId: actor.tenantId,
        threadId: id,
        stageKey: "evidence_plan",
        status: "ready",
        summary: workflowPolicy.stageSummaries.evidenceReady,
        metadata: {
          checklistOverrideUsed: allowIncomplete && missingRequired.length > 0,
          policyVersion: workflowPolicy.version,
        },
        updatedByUserId: actor.userId,
      });

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

      const baseSystemPrompt =
        "You are Overture document assistant. Draft concise insurance appeal documents. PHI processing is disabled, so do not include personally identifying patient details.";
      const promptContext = deps.resolvePromptContext
        ? await deps.resolvePromptContext({
            db: client,
            organizationId: actor.organizationId ?? actor.tenantId,
            authSubject: auth.userSub,
            fallbackSystemPrompt: baseSystemPrompt,
          })
        : { composedSystemPrompt: baseSystemPrompt };

      const assistantDraft = await deps.generateTextWithBedrock({
        systemPrompt: `${promptContext.composedSystemPrompt}\n\n${placeholderInstructionBlock()}`,
        userPrompt: [
          `Document kind: ${kind}`,
          `Thread ID: ${id}`,
          `User instructions: ${sanitizedInstructions?.sanitizedText || "None provided."}`,
          `Recent user message context: ${sanitizedContext?.sanitizedText || "No prior thread messages."}`,
        ].join("\n"),
        temperature: 0.2,
      });
      const draftPhiContext = mergeDraftPhiContext(
        fullUserContext ? collectDraftPhiContext(fullUserContext) : {},
        body.instructions?.trim() ? collectDraftPhiContext(body.instructions.trim()) : {},
      );
      const hydratedDraft = hydrateDraftPlaceholders(normalizeToCanonicalPlaceholders(assistantDraft), draftPhiContext);

      const insertResult = await client.query<{ id: string; created_at: string }>(
        `
          INSERT INTO generated_document (tenant_id, thread_id, kind, version, content, citations, created_by_user_id)
          VALUES ($1::uuid, $2::uuid, $3, $4, $5, '[]'::jsonb, $6::uuid)
          RETURNING id, created_at
        `,
        [actor.tenantId, id, kind, nextVersion, hydratedDraft, actor.userId],
      );
      const document = insertResult.rows[0];

      const kindLabel = kind === "lmn" ? "LMN" : kind === "p2p" ? "P2P" : "Appeal";
      const updateSummary = `Created ${kindLabel} v${nextVersion} based on your latest request. I updated the draft and linked it below.`;
      const updateToken = `[[DOCUMENT_UPDATE|${document.id}|${kindLabel} v${nextVersion}|created|/document/${id}?doc=${document.id}]]`;
      await client.query(
        `
          INSERT INTO message (tenant_id, thread_id, role, content, citations)
          VALUES ($1::uuid, $2::uuid, 'assistant', $3, '[]'::jsonb)
        `,
        [actor.tenantId, id, `${updateSummary}\n\n${updateToken}`],
      );
      await client.query(
        `
          UPDATE thread
          SET updated_at = NOW()
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
        `,
        [id, actor.tenantId],
      );
      await upsertWorkflowStage(client, {
        tenantId: actor.tenantId,
        threadId: id,
        stageKey: "draft_plan",
        status: "complete",
        summary: `${workflowPolicy.stageSummaries.draftComplete} (${kindLabel} v${nextVersion}).`,
        metadata: {
          documentId: document.id,
          kind,
          version: nextVersion,
          checklistOverrideUsed: allowIncomplete && missingRequired.length > 0,
          policyVersion: workflowPolicy.version,
        },
        updatedByUserId: actor.userId,
      });

      await deps.insertAuditEvent(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "document.generate",
        entityType: "generated_document",
        entityId: document.id,
        metadata: {
          outcome: "success",
          threadId: id,
          documentId: document.id,
          kind,
          version: nextVersion,
          modelId: deps.getBedrockModelId(),
          phiProcessingEnabled: false,
          checklistMissingCount: missingRequired.length,
          checklistOverrideUsed: allowIncomplete && missingRequired.length > 0,
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
            outcome: "blocked",
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
