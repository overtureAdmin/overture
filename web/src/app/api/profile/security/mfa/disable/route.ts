import {
  AdminGetUserCommand,
  AdminSetUserMFAPreferenceCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getCognitoUsernameFromRequestAccessToken } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { optionalEnv, requireEnv } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/http";
import { buildProfilePolicy } from "@/lib/profile-policy";
import { ensureTenantAndUser } from "@/lib/tenant-context";

function getCognitoClient() {
  const region = optionalEnv("COGNITO_REGION") ?? optionalEnv("AWS_REGION") ?? "us-east-1";
  return new CognitoIdentityProviderClient({ region });
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const username = getCognitoUsernameFromRequestAccessToken(request);
  if (!username) {
    return jsonError("Missing session identity. Please sign out and sign in again.", 401);
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const policy = buildProfilePolicy(actor);
    if (!policy.actions.canManageMfa) {
      return jsonError("MFA management is disabled for this account", 403);
    }

    const cognito = getCognitoClient();
    const userPoolId = requireEnv("COGNITO_USER_POOL_ID");
    await cognito.send(
      new AdminSetUserMFAPreferenceCommand({
        UserPoolId: userPoolId,
        Username: username,
        SoftwareTokenMfaSettings: {
          Enabled: false,
          PreferredMfa: false,
        },
      }),
    );

    const state = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }),
    );
    const hasSoftwareToken = (state.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA");
    if (hasSoftwareToken) {
      return jsonError("MFA is still required for this account. Replace the authenticator app instead of disabling MFA.", 409);
    }

    return jsonOk({ ok: true });
  } catch (error) {
    console.error("POST /api/profile/security/mfa/disable failed", error);
    const code = (error as { name?: string; code?: string; message?: string } | null)?.name ?? (error as { code?: string } | null)?.code;
    if (code === "NotAuthorizedException") {
      return jsonError("MFA disable is not authorized for this account.", 403);
    }
    return jsonError("Failed to disable MFA devices", 500);
  }
}
