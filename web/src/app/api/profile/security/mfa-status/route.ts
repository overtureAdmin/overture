import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
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

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const policy = buildProfilePolicy(actor);
    let softwareTokenEnabled = false;
    let preferredMethod: "software_token" | "sms" | "none" = "none";

    const username = getCognitoUsernameFromRequestAccessToken(request);
    if (username) {
      try {
        const cognito = getCognitoClient();
        const userPoolId = requireEnv("COGNITO_USER_POOL_ID");
        const user = await cognito.send(
          new AdminGetUserCommand({
            UserPoolId: userPoolId,
            Username: username,
          }),
        );
        softwareTokenEnabled = (user.UserMFASettingList ?? []).includes("SOFTWARE_TOKEN_MFA");
        if (user.PreferredMfaSetting === "SOFTWARE_TOKEN_MFA") {
          preferredMethod = "software_token";
        } else if (user.PreferredMfaSetting === "SMS_MFA") {
          preferredMethod = "sms";
        }
      } catch (error) {
        console.error("GET /api/profile/security/mfa-status cognito read failed", error);
      }
    }

    return jsonOk({
      required: true,
      enabled: softwareTokenEnabled || auth.mfaAuthenticated === true,
      softwareTokenEnabled,
      preferredMethod,
      sessionMfaAuthenticated: auth.mfaAuthenticated,
      manageable: policy.actions.canManageMfa,
      reason: policy.actions.canManageMfa ? null : "Organization is suspended. Contact support.",
    });
  } catch (error) {
    console.error("GET /api/profile/security/mfa-status failed", error);
    return jsonError("Failed to load MFA status", 500);
  }
}
