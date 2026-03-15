import { jsonError, parseJsonBody } from "@/lib/http";
import { verifyLoginMfaSetup } from "@/domains/identity/auth-entry-service";

type Body = {
  email?: string;
  code?: string;
  session?: string;
  rememberMe?: boolean;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<Body>(request);

  try {
    return await verifyLoginMfaSetup({
      request,
      email: body?.email,
      code: body?.code,
      session: body?.session,
      rememberMe: body?.rememberMe,
    });
  } catch (error) {
    const code = (error as { name?: string }).name;
    const message = error instanceof Error ? error.message : "Unable to verify MFA setup right now.";
    if (message === "Email, session, and a valid 6-digit MFA code are required.") {
      return jsonError(message, 422);
    }
    if (message === "That authenticator code could not be verified.") {
      return jsonError(message, 422);
    }
    if (message === "Unable to complete MFA setup sign-in.") {
      return jsonError(message, 500);
    }
    if (code === "CodeMismatchException") {
      return jsonError("That authenticator code is incorrect.", 422);
    }
    if (code === "EnableSoftwareTokenMFAException") {
      return jsonError("Authenticator enrollment could not be completed. Start setup again.", 422);
    }
    console.error("POST /api/auth/login/mfa/setup/verify failed", error);
    return jsonError("Unable to verify MFA setup right now.", 500);
  }
}
