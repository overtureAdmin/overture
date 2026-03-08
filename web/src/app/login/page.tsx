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
    return "Sign-in failed while exchanging session tokens. Please try again.";
  }
  if (error === "auth_provider_error") {
    if (reason && reason.length > 0) {
      return `Hosted sign-in error: ${decodeURIComponent(reason)}`;
    }
    return "Hosted sign-in returned an error. Please try again.";
  }
  return "Sign-in failed. Please try again.";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = normalizeNextPath(params.next);
  const loginHref = `/auth/login?next=${encodeURIComponent(nextPath)}`;
  const message = errorMessage(params.error, params.reason);

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-5xl grid-cols-1 items-center gap-6 px-6 py-10 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="calm-card-soft p-7 md:p-10">
        <img src="/overture-logo.png" alt="Overture" className="h-11 w-auto" />
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#331c4a] md:text-5xl">
          Draft stronger appeals with confidence.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#685285] md:text-base">
          Continue through secure sign-in to access your case workspace, document history, checklist guidance, and
          export tools.
        </p>
        <div className="mt-6 grid max-w-lg grid-cols-1 gap-2 text-xs text-[#685285] md:grid-cols-2">
          <span className="calm-badge px-3 py-1">Live Workspace</span>
          <span className="calm-badge px-3 py-1">Smart Revisions</span>
          <span className="calm-badge px-3 py-1">Version Control</span>
          <span className="calm-badge px-3 py-1">DOCX / PDF Export</span>
        </div>
      </section>

      <section className="calm-card p-6 md:p-8">
        <h2 className="text-2xl font-semibold tracking-tight text-[#331c4a]">Sign In</h2>
        <p className="mt-2 text-sm text-[#695386]">
          Use secure Hosted UI authentication to sign in or create an account. New users complete BAA, billing, and profile setup after login.
        </p>

        {message ? (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
        ) : null}

        <a href={loginHref} className="calm-primary mt-7 inline-flex w-full items-center justify-center px-4 py-3 text-sm font-medium">
          Continue To Sign In
        </a>

        <p className="mt-4 text-xs text-[#755e93]">
          After authentication, we route you through required setup gates before access to {nextPath}.
        </p>
      </section>
    </main>
  );
}
