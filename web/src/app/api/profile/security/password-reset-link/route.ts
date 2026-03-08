import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { buildProfilePolicy } from "@/lib/profile-policy";
import { ensureTenantAndUser } from "@/lib/tenant-context";

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const policy = buildProfilePolicy(actor);
    if (!policy.actions.canRequestPasswordReset) {
      return jsonError("Password reset is disabled while organization is suspended", 403);
    }

    return jsonOk(
      {
        action: "hosted_ui_forgot_password",
        loginPath: "/login",
        instructions: "Use the Hosted UI 'Forgot your password?' flow from the login page.",
      },
      201,
    );
  } catch (error) {
    console.error("POST /api/profile/security/password-reset-link failed", error);
    return jsonError("Failed to prepare password reset flow", 500);
  }
}
