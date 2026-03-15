import { NextResponse } from "next/server";
import { jsonError, parseJsonBody } from "@/lib/http";
import { startPasswordLogin } from "@/domains/identity/auth-entry-service";

type LoginBody = {
  email?: string;
  password?: string;
  rememberMe?: boolean;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<LoginBody>(request);

  try {
    return await startPasswordLogin({
      request,
      email: body?.email,
      password: body?.password,
      rememberMe: body?.rememberMe,
    });
  } catch (error) {
    const code = (error as { name?: string }).name;
    const message = error instanceof Error ? error.message : "Unable to sign in right now.";
    if (message === "Email and password are required.") {
      return jsonError(message, 422);
    }
    if (message === "Unable to complete sign-in.") {
      return jsonError(message, 500);
    }
    if (code === "UserNotConfirmedException") {
      const email = body?.email?.trim().toLowerCase() ?? "";
      return NextResponse.json(
        {
          ok: true,
          requestId: crypto.randomUUID(),
          data: {
            status: "confirmation_required",
            email,
          },
        },
        { status: 200 },
      );
    }
    if (code === "NotAuthorizedException") {
      return jsonError("Incorrect email, password, or MFA state.", 401);
    }
    if (code === "PasswordResetRequiredException") {
      return jsonError("Password reset required. Use the reset flow to continue.", 403);
    }
    console.error("POST /api/auth/login failed", error);
    return jsonError("Unable to sign in right now.", 500);
  }
}
