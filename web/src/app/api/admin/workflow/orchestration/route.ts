import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";
import {
  getWorkflowOrchestrationPolicy,
  normalizeWorkflowOrchestrationPolicy,
  saveWorkflowOrchestrationPolicy,
  type WorkflowOrchestrationPolicy,
} from "@/lib/workflow-orchestration";

type Body = {
  policy?: WorkflowOrchestrationPolicy;
};

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const db = getDbPool();
  try {
    const policy = await getWorkflowOrchestrationPolicy(db);
    return jsonOk({ policy });
  } catch (error) {
    console.error("GET /api/admin/workflow/orchestration failed", error);
    return jsonError("Failed to load workflow orchestration policy", 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const body = await parseJsonBody<Body>(request);
  const policy = normalizeWorkflowOrchestrationPolicy(body?.policy);
  const db = getDbPool();
  try {
    await saveWorkflowOrchestrationPolicy({ db, actorSubject: auth.userSub, policy });
    await db.query(
      `
        INSERT INTO super_admin_action_log (actor_subject, action, metadata)
        VALUES ($1, 'admin.workflow_orchestration_update', $2::jsonb)
      `,
      [
        auth.userSub,
        JSON.stringify({
          n8nEnabled: policy.n8nEnabled,
          dispatchMode: policy.dispatchMode,
          webhookConfigured: policy.webhookUrl.length > 0,
        }),
      ],
    );
    return jsonOk({ updated: true, policy });
  } catch (error) {
    console.error("PATCH /api/admin/workflow/orchestration failed", error);
    return jsonError("Failed to update workflow orchestration policy", 500);
  }
}
