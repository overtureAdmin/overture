import {
  CognitoIdentityProviderClient,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { authRequiredResponse, getAccessTokenFromRequest, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { optionalEnv } from "@/lib/env";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { buildProfilePolicy } from "@/lib/profile-policy";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type VerifyBody = {
  code?: string;
  session?: string | null;
};

function getCognitoClient() {
  const region = optionalEnv("COGNITO_REGION") ?? optionalEnv("AWS_REGION") ?? "us-east-1";
  return new CognitoIdentityProviderClient({ region });
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

  const body = await parseJsonBody<VerifyBody>(request);
  const code = body?.code?.trim() ?? "";
  if (!/^\d{6}$/.test(code)) {
    return jsonError("Enter a valid 6-digit authenticator code", 422);
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const policy = buildProfilePolicy(actor);
    if (!policy.actions.canManageMfa) {
      return jsonError("MFA management is disabled for this account", 403);
    }

    const cognito = getCognitoClient();
    const verifyResult = await cognito.send(
      new VerifySoftwareTokenCommand({
        AccessToken: accessToken,
        UserCode: code,
        Session: body?.session ?? undefined,
      }),
    );
    if (verifyResult.Status !== "SUCCESS") {
      return jsonError("MFA code verification failed", 422);
    }

    await cognito.send(
      new SetUserMFAPreferenceCommand({
        AccessToken: accessToken,
        SoftwareTokenMfaSettings: {
          Enabled: true,
          PreferredMfa: true,
        },
      }),
    );

    return jsonOk({ ok: true });
  } catch (error) {
    console.error("POST /api/profile/security/mfa/setup/verify failed", error);
    const code = (error as { name?: string; code?: string } | null)?.name ?? (error as { code?: string } | null)?.code;
    if (code === "NotAuthorizedException") {
      return jsonError("MFA verification requires a refreshed session. Please sign out and sign in again.", 403);
    }
    return jsonError("Failed to verify MFA device", 500);
  }
}
