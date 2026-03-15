import { AuthWorkspace } from "@/components/auth/auth-workspace";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string; reason?: string }>;
};

function normalizeNextPath(input: string | undefined) {
  if (!input || !input.startsWith("/") || input.startsWith("//")) {
    return "/app";
  }
  return input;
}

function errorMessage(error: string | undefined, reason: string | undefined) {
  if (!error) {
    return null;
  }
  if (error === "auth_callback_invalid_state") {
    return "Sign-in session expired. Please try again.";
  }
  if (error === "auth_token_exchange_failed") {
    return "Sign-in failed. Please try again.";
  }
  if (error === "auth_provider_error") {
    if (reason && reason.length > 0) {
      return `Sign-in error: ${decodeURIComponent(reason)}`;
    }
    return "Sign-in returned an error. Please try again.";
  }
  return "Sign-in failed. Please try again.";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = normalizeNextPath(params.next);
  const message = errorMessage(params.error, params.reason);

  return <AuthWorkspace initialNextPath={nextPath} initialMessage={message} />;
}
