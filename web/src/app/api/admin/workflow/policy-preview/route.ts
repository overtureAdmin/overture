import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";
import { evaluateRequiredChecklist, hasStructuredIntakeContext } from "@/lib/workflow-checklist";
import { getWorkflowPolicy } from "@/lib/workflow-policy";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function summarizePreview(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 220);
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
  const organizationId = (searchParams.get("organizationId") ?? "").trim();
  const requestedThreadId = (searchParams.get("threadId") ?? "").trim();
  if (!organizationId || !isUuid(organizationId)) {
    return jsonError("Missing required field: organizationId", 422);
  }
  if (requestedThreadId && !isUuid(requestedThreadId)) {
    return jsonError("Invalid field: threadId", 422);
  }

  const db = getDbPool();
  try {
    const [organizationResult, workflowPolicy] = await Promise.all([
      db.query<{ id: string; name: string }>(
        `
          SELECT id, name
          FROM organization
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [organizationId],
      ),
      getWorkflowPolicy(db),
    ]);
    const organization = organizationResult.rows[0];
    if (!organization) {
      return jsonError("Organization not found", 404);
    }

    const threadsResult = await db.query<{
      id: string;
      title: string;
      updated_at: string;
      latest_user_content: string | null;
      latest_user_created_at: string | null;
    }>(
      `
        SELECT
          t.id,
          t.title,
          t.updated_at,
          latest_user.content AS latest_user_content,
          latest_user.created_at AS latest_user_created_at
        FROM thread t
        LEFT JOIN LATERAL (
          SELECT m.content, m.created_at
          FROM message m
          WHERE m.tenant_id = t.tenant_id
            AND m.thread_id = t.id
            AND m.role = 'user'
          ORDER BY m.created_at DESC
          LIMIT 1
        ) latest_user ON TRUE
        WHERE t.tenant_id = $1::uuid
        ORDER BY t.updated_at DESC
        LIMIT 100
      `,
      [organizationId],
    );

    const selectedThread =
      (requestedThreadId
        ? threadsResult.rows.find((row) => row.id === requestedThreadId)
        : null) ?? threadsResult.rows[0] ?? null;
    const latestUserContent = selectedThread?.latest_user_content ?? "";
    const hasStructuredContext = latestUserContent ? hasStructuredIntakeContext(latestUserContent) : false;
    const { requiredFields, missingRequired } = evaluateRequiredChecklist({
      policy: workflowPolicy,
      checklistContext: latestUserContent,
      hasStructuredContext,
    });

    let status: "ready" | "blocked" | "pending_context" = "ready";
    if (workflowPolicy.requireChecklistCompletion) {
      if (!hasStructuredContext) {
        status = "pending_context";
      } else if (missingRequired.length > 0) {
        status = "blocked";
      }
    }

    return jsonOk({
      organizationId: organization.id,
      organizationName: organization.name,
      policyVersion: workflowPolicy.version,
      requireChecklistCompletion: workflowPolicy.requireChecklistCompletion,
      threads: threadsResult.rows.map((thread) => ({
        id: thread.id,
        title: thread.title,
        updatedAt: thread.updated_at,
        hasStructuredContext: thread.latest_user_content ? hasStructuredIntakeContext(thread.latest_user_content) : false,
        latestUserPreview: summarizePreview(thread.latest_user_content ?? ""),
      })),
      selectedThreadId: selectedThread?.id ?? null,
      evaluation: selectedThread
        ? {
            status,
            hasStructuredContext,
            requiredFields: requiredFields.map((field) => field.label),
            missingRequired,
            latestUserMessageAt: selectedThread.latest_user_created_at,
            latestUserPreview: summarizePreview(latestUserContent),
          }
        : null,
    });
  } catch (error) {
    console.error("GET /api/admin/workflow/policy-preview failed", error);
    return jsonError("Failed to load workflow policy preview", 500);
  }
}
