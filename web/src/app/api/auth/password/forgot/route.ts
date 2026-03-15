import { jsonError, parseJsonBody } from "@/lib/http";
import { startForgotPassword } from "@/domains/identity/auth-entry-service";

type ForgotBody = {
  email?: string;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<ForgotBody>(request);

  try {
    return await startForgotPassword(body ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start password reset right now.";
    if (message === "Email is required.") {
      return jsonError(message, 422);
    }
    console.error("POST /api/auth/password/forgot failed", error);
    return jsonError("Unable to start password reset right now.", 500);
  }
}
