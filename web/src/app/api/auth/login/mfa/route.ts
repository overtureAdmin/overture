import { jsonError, parseJsonBody } from "@/lib/http";
import { completeLoginMfa } from "@/domains/identity/auth-entry-service";

type MfaBody = {
  email?: string;
  code?: string;
  session?: string;
  rememberMe?: boolean;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<MfaBody>(request);

  try {
    return await completeLoginMfa({
      request,
      email: body?.email,
      code: body?.code,
      session: body?.session,
      rememberMe: body?.rememberMe,
    });
  } catch (error) {
    const code = (error as { name?: string }).name;
    const message = error instanceof Error ? error.message : "Unable to verify MFA code right now.";
    if (message === "Email, session, and a valid 6-digit MFA code are required.") {
      return jsonError(message, 422);
    }
    if (message === "Unable to complete MFA verification.") {
      return jsonError(message, 500);
    }
    if (code === "CodeMismatchException") {
      return jsonError("That verification code is incorrect.", 422);
    }
    if (code === "ExpiredCodeException") {
      return jsonError("This verification code expired. Try again.", 422);
    }
    console.error("POST /api/auth/login/mfa failed", error);
    return jsonError("Unable to verify MFA code right now.", 500);
  }
}
