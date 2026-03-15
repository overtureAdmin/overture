import { jsonError, parseJsonBody } from "@/lib/http";
import { startLoginMfaSetup } from "@/domains/identity/auth-entry-service";

type Body = {
  session?: string;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<Body>(request);
  const emailHeader = request.headers.get("x-auth-email")?.trim().toLowerCase() ?? "";

  try {
    return await startLoginMfaSetup({
      session: body?.session,
      email: emailHeader,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start MFA setup right now.";
    if (message === "Session and account email are required to start MFA setup.") {
      return jsonError(message, 422);
    }
    if (message === "Unable to start MFA setup.") {
      return jsonError(message, 500);
    }
    console.error("POST /api/auth/login/mfa/setup/start failed", error);
    return jsonError("Unable to start MFA setup right now.", 500);
  }
}
