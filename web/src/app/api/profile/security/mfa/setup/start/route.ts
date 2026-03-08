import { AssociateSoftwareTokenCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { authRequiredResponse, getAccessTokenFromRequest, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { optionalEnv } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/http";
import { buildProfilePolicy } from "@/lib/profile-policy";
import { ensureTenantAndUser } from "@/lib/tenant-context";

function getCognitoClient() {
  const region = optionalEnv("COGNITO_REGION") ?? optionalEnv("AWS_REGION") ?? "us-east-1";
  return new CognitoIdentityProviderClient({ region });
}

function buildOtpAuthUri(secretCode: string, email: string | null, userSub: string): string {
  const issuer = "Overture";
  const accountName = (email && email.trim().length > 0 ? email.trim() : userSub).replace(/:/g, "");
  const label = `${issuer}:${accountName}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secretCode)}&issuer=${encodeURIComponent(issuer)}`;
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const accessToken = getAccessTokenFromRequest(request);
  if (!accessToken) {
    return jsonError("Missing access token. Please sign in again.", 401);
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const policy = buildProfilePolicy(actor);
    if (!policy.actions.canManageMfa) {
      return jsonError("MFA management is disabled for this account", 403);
    }

    const cognito = getCognitoClient();
    const result = await cognito.send(
      new AssociateSoftwareTokenCommand({
        AccessToken: accessToken,
      }),
    );

    if (!result.SecretCode) {
      return jsonError("Unable to start MFA setup", 500);
    }

    return jsonOk({
      secretCode: result.SecretCode,
      otpauthUri: buildOtpAuthUri(result.SecretCode, auth.email, auth.userSub),
      session: result.Session ?? null,
    });
  } catch (error) {
    console.error("POST /api/profile/security/mfa/setup/start failed", error);
    const code = (error as { name?: string; code?: string } | null)?.name ?? (error as { code?: string } | null)?.code;
    if (code === "NotAuthorizedException") {
      return jsonError("MFA setup requires a refreshed session. Please sign out and sign in again.", 403);
    }
    return jsonError("Failed to start MFA setup", 500);
  }
}
