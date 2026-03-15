import { jsonError, parseJsonBody } from "@/lib/http";
import { startSignUp } from "@/domains/identity/auth-entry-service";

type SignUpBody = {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<SignUpBody>(request);

  try {
    return await startSignUp(body ?? {});
  } catch (error) {
    const code = (error as { name?: string }).name;
    const message = error instanceof Error ? error.message : "Unable to create account right now.";
    if (message === "First name, last name, email, and password are required.") {
      return jsonError(message, 422);
    }
    if (code === "UsernameExistsException") {
      return jsonError("An account already exists for this email.", 409);
    }
    if (code === "InvalidPasswordException") {
      return jsonError("Password does not meet the security requirements.", 422);
    }
    if (code === "NotAuthorizedException") {
      return jsonError("Self-signup is not enabled in the current Cognito configuration.", 403);
    }
    console.error("POST /api/auth/signup failed", error);
    return jsonError("Unable to create account right now.", 500);
  }
}
