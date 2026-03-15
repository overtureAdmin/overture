import { jsonError, parseJsonBody } from "@/lib/http";
import { confirmSignUp } from "@/domains/identity/auth-entry-service";

type ConfirmBody = {
  email?: string;
  code?: string;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<ConfirmBody>(request);

  try {
    return await confirmSignUp(body ?? {});
  } catch (error) {
    const failure = (error as { name?: string }).name;
    const message = error instanceof Error ? error.message : "Unable to confirm account right now.";
    if (message === "Email and verification code are required.") {
      return jsonError(message, 422);
    }
    if (failure === "CodeMismatchException") {
      return jsonError("That verification code is incorrect.", 422);
    }
    if (failure === "ExpiredCodeException") {
      return jsonError("That verification code expired. Request a new one.", 422);
    }
    console.error("POST /api/auth/signup/confirm failed", error);
    return jsonError("Unable to confirm account right now.", 500);
  }
}
