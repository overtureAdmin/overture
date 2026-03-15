import { jsonError, parseJsonBody } from "@/lib/http";
import { completeForgotPassword } from "@/domains/identity/auth-entry-service";

type ResetBody = {
  email?: string;
  code?: string;
  newPassword?: string;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<ResetBody>(request);

  try {
    return await completeForgotPassword(body ?? {});
  } catch (error) {
    const failure = (error as { name?: string }).name;
    const message = error instanceof Error ? error.message : "Unable to reset password right now.";
    if (message === "Email, verification code, and new password are required.") {
      return jsonError(message, 422);
    }
    if (failure === "CodeMismatchException") {
      return jsonError("That verification code is incorrect.", 422);
    }
    if (failure === "ExpiredCodeException") {
      return jsonError("That verification code expired. Request a new one.", 422);
    }
    if (failure === "InvalidPasswordException") {
      return jsonError("Password does not meet the security requirements.", 422);
    }
    console.error("POST /api/auth/password/reset failed", error);
    return jsonError("Unable to reset password right now.", 500);
  }
}
