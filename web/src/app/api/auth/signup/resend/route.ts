import { jsonError, parseJsonBody } from "@/lib/http";
import { resendSignUpConfirmation } from "@/domains/identity/auth-entry-service";

type ResendBody = {
  email?: string;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<ResendBody>(request);

  try {
    return await resendSignUpConfirmation(body ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resend verification code right now.";
    if (message === "Email is required.") {
      return jsonError(message, 422);
    }
    console.error("POST /api/auth/signup/resend failed", error);
    return jsonError("Unable to resend verification code right now.", 500);
  }
}
