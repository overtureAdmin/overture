import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { isUnitySuperAdmin } from "@/lib/super-admin";

type ResetPasswordBody = {
  organizationId: string;
  authSubject: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const body = await parseJsonBody<ResetPasswordBody>(request);
  const organizationId = body?.organizationId?.trim() ?? "";
  const authSubject = body?.authSubject?.trim() ?? "";
  if (!organizationId || !isUuid(organizationId) || !authSubject) {
    return jsonError("Missing required fields: organizationId, authSubject", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    const userResult = await client.query<{ email: string | null }>(
      `
        SELECT ui.email
        FROM organization_membership om
        INNER JOIN user_identity ui
          ON ui.auth_subject = om.auth_subject
        WHERE om.organization_id = $1::uuid
          AND om.auth_subject = $2
        LIMIT 1
      `,
      [organizationId, authSubject],
    );
    const email = userResult.rows[0]?.email?.trim() ?? "";
    if (!email) {
      return jsonError("Target user has no email on record", 422);
    }

    await client.query(
      `
        INSERT INTO audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
        VALUES ($1::uuid, NULL, 'admin.user_password_reset', 'organization', $1::uuid, $2::jsonb)
      `,
      [
        organizationId,
        JSON.stringify({
          supportSubject: auth.userSub,
          targetAuthSubject: authSubject,
          email,
          action: "forgot_password_via_hosted_ui",
        }),
      ],
    );

    return jsonOk({
      ok: true,
      action: "hosted_ui_forgot_password",
      loginPath: "/login",
      emailHint: email,
      instructions: "Open login, click 'Forgot your password?', and complete reset for this user email.",
    });
  } catch (error) {
    console.error("POST /api/admin/users/reset-password failed", error);
    return jsonError("Failed to trigger password reset", 500);
  } finally {
    client.release();
  }
}
