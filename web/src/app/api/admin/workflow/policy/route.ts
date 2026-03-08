import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";
import { getWorkflowPolicy, normalizeWorkflowPolicy, type WorkflowPolicy } from "@/lib/workflow-policy";

type WorkflowPolicyBody = {
  policy?: WorkflowPolicy;
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
    const policy = await getWorkflowPolicy(db);
    return jsonOk({ policy });
  } catch (error) {
    console.error("GET /api/admin/workflow/policy failed", error);
    return jsonError("Failed to load workflow policy", 500);
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

  const body = await parseJsonBody<WorkflowPolicyBody>(request);
  const policy = normalizeWorkflowPolicy(body?.policy);

  const db = getDbPool();
  try {
    await db.query(
      `
        INSERT INTO admin_workflow_policy (id, policy, updated_by_subject, updated_at)
        VALUES (1, $1::jsonb, $2, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          policy = EXCLUDED.policy,
          updated_by_subject = EXCLUDED.updated_by_subject,
          updated_at = NOW()
      `,
      [JSON.stringify(policy), auth.userSub],
    );
    await db.query(
      `
        INSERT INTO super_admin_action_log (actor_subject, action, metadata)
        VALUES ($1, 'admin.workflow_policy_update', $2::jsonb)
      `,
      [auth.userSub, JSON.stringify({ requiredFieldCount: policy.requiredFieldKeys.length, requireChecklistCompletion: policy.requireChecklistCompletion })],
    );
    return jsonOk({ updated: true, policy });
  } catch (error) {
    console.error("PATCH /api/admin/workflow/policy failed", error);
    return jsonError("Failed to update workflow policy", 500);
  }
}
