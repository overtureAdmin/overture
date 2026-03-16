"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  acceptBaa,
  acceptTerms,
  completeOnboarding,
  getMfaStatus,
  getProfileStatus,
  setupOrganization,
  startMfaSetup,
  verifyMfaSetup,
} from "@/lib/client-api";
import { BAA_COPY, TERMS_OF_USE_COPY } from "@/lib/legal-copy";
import {
  AuthAlert,
  AuthCard,
  AuthField,
  AuthHeading,
  AuthInput,
  AuthKicker,
  AuthLinkButton,
  AuthPrimaryButton,
  AuthSecondaryButton,
  AuthShell,
} from "@/components/auth/auth-primitives";

type AuthWorkspaceProps = {
  initialNextPath: string;
  initialMessage: string | null;
};

type AuthMode = "login" | "signup" | "forgot" | "reset";
type SignupStage = "account" | "organization" | "profile" | "terms" | "baa" | "confirm" | "mfa";
type AuthStatus =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "success"; message: string };

type LoginResponse =
  | { status: "authenticated"; nextPath: string }
  | { status: "mfa_required"; session: string; email: string; destination: string }
  | { status: "mfa_setup_required"; session: string; email: string; destination: string }
  | { status: "confirmation_required"; email: string };

type SignupResponse = {
  status: "confirmation_required";
  email: string;
  userConfirmed: boolean;
  destination: string;
};

type AuthenticatedMfaSetupState = {
  flow: "authenticated";
  session: string | null;
  otpauthUri: string;
  secretCode: string;
  qrCodeDataUrl: string;
};

type ChallengeMfaSetupState = {
  flow: "challenge";
  email: string;
  session: string;
  otpauthUri: string;
  secretCode: string;
  qrCodeDataUrl: string;
};

type SignupFormState = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  organizationAction: "create" | "join";
  organizationName: string;
  inviteCode: string;
  legalName: string;
  jobTitle: string;
  phone: string;
  acceptTerms: boolean;
  acceptBaa: boolean;
};

type AuthHeaderContent = {
  kicker: string;
  title: string;
  body: string;
};

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-[#6d24a2]">
      <path d="M6.75 8V6.75a3.25 3.25 0 1 1 6.5 0V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="4.5" y="8" width="11" height="8" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}


async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error) {
      return payload.error;
    }
  } catch {
    // ignore JSON parse errors and fall back
  }
  return `Request failed with status ${response.status}`;
}

async function postJson<T>(url: string, body: unknown, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    ...init,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const payload = (await response.json()) as { data: T };
  return payload.data;
}

function normalizePhoneNumber(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("+")) {
    return trimmed;
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits ? `+1 ${digits}` : trimmed;
}

function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function buildMaskedPassword(password: string) {
  if (password.length < 12) {
    return "Use at least 12 characters.";
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return "Include upper, lower, and a number.";
  }
  return null;
}



function PasswordToggle(props: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center rounded-md px-2 py-1 text-[12px] font-medium text-[#6a2d9c] transition-colors duration-200 hover:text-[#55207f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b28bd8]"
    >
      {props.visible ? "Hide" : "Show"}
    </button>
  );
}

function AuthCheckbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-3 text-[13px] leading-6 text-[#5f536d]">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-[#cdbfdb] text-[#6d24a2] focus:ring-[#b28bd8]"
      />
      <span>
        <span className="block text-[#493b57]">{props.label}</span>
        {props.description ? <span className="block text-[12px] leading-5 text-[#83778f]">{props.description}</span> : null}
      </span>
    </label>
  );
}

function ChoiceCard(props: {
  active: boolean;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded-[18px] border px-4 py-4 text-left transition-colors duration-200 ${
        props.active
          ? "border-[#cdbfdb] bg-[#f5f1f8] shadow-[0_10px_24px_rgba(48,26,74,0.05)]"
          : "border-[#ebe5ef] bg-[#fcfbfd] hover:border-[#d9cedf] hover:bg-white"
      }`}
    >
      <p className="text-[14px] font-semibold tracking-[-0.01em] text-[#2d2137]">{props.title}</p>
      <p className="mt-2 text-[13px] leading-6 text-[#6e6379]">{props.body}</p>
    </button>
  );
}

function AuthSectionNote(props: { children: ReactNode }) {
  return <div className="rounded-[18px] border border-[#e6deeb] bg-[#faf8fb] px-4 py-3 text-[13px] leading-6 text-[#665a71]">{props.children}</div>;
}

function authHeader(mode: AuthMode, loginMfaSession: string | null, signupStage: SignupStage): AuthHeaderContent {
  if (mode === "login") {
    if (loginMfaSession) {
      return {
        kicker: "Security Check",
        title: "Verify your authenticator code",
        body: "Finish sign-in with the current 6-digit code from your authenticator app.",
      };
    }
    return {
      kicker: "Sign In",
      title: "Sign in to Overture",
      body: "Continue working on denials, appeals, LMNs, and payer evidence.",
    };
  }

  if (mode === "forgot") {
    return {
      kicker: "Password Recovery",
      title: "Request a reset code",
      body: "Enter your work email and we will send a secure code to reset your password.",
    };
  }

  if (mode === "reset") {
    return {
      kicker: "Password Recovery",
      title: "Set a new password",
      body: "Use the code from your email, then choose a new password for your account.",
    };
  }

  if (signupStage === "terms") {
    return {
      kicker: "Legal Review",
      title: "Terms of Use",
      body: "Scroll through the full document before accepting.",
    };
  }

  if (signupStage === "baa") {
    return {
      kicker: "Legal Review",
      title: "Business Associate Agreement",
      body: "Scroll through the full document before accepting.",
    };
  }

  if (signupStage === "confirm") {
    return {
      kicker: "Create Account",
      title: "Confirm your email",
      body: "Enter the verification code we sent to finish securing your account.",
    };
  }

  if (signupStage === "mfa") {
    return {
      kicker: "Security Setup",
      title: "Enable multi-factor authentication",
      body: "Complete MFA setup now so account access starts from a secure baseline.",
    };
  }

  return {
    kicker: "Create Account",
    title: "Create your Overture account",
    body: "Set up your account, confirm organization details, and complete secure onboarding.",
  };
}

export function AuthWorkspace(props: AuthWorkspaceProps) {
  const router = useRouter();

  const [mode, setMode] = useState<AuthMode>("login");
  const [signupStage, setSignupStage] = useState<SignupStage>("account");
  const [status, setStatus] = useState<AuthStatus>({ kind: "idle" });
  const [error, setError] = useState<string | null>(props.initialMessage);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginMfaCode, setLoginMfaCode] = useState("");
  const [loginMfaSession, setLoginMfaSession] = useState<string | null>(null);
  const [loginMfaEmail, setLoginMfaEmail] = useState<string | null>(null);

  const [forgotEmail, setForgotEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [confirmCode, setConfirmCode] = useState("");
  const [resendCountdown, setResendCountdown] = useState(0);
  const [pendingAuthSetup, setPendingAuthSetup] = useState<AuthenticatedMfaSetupState | null>(null);
  const [pendingChallengeSetup, setPendingChallengeSetup] = useState<ChallengeMfaSetupState | null>(null);
  const [mfaSetupCode, setMfaSetupCode] = useState("");

  const [signup, setSignup] = useState<SignupFormState>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    organizationAction: "create",
    organizationName: "",
    inviteCode: "",
    legalName: "",
    jobTitle: "",
    phone: "",
    acceptTerms: false,
    acceptBaa: false,
  });

  useEffect(() => {
    if (resendCountdown <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setResendCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCountdown]);

  useEffect(() => {
    if (!signup.legalName.trim() && (signup.firstName.trim() || signup.lastName.trim())) {
      const combined = `${signup.firstName} ${signup.lastName}`.trim();
      setSignup((current) => ({ ...current, legalName: combined }));
    }
  }, [signup.firstName, signup.lastName, signup.legalName]);

  const termsScrollRef = useRef<HTMLDivElement>(null);
  const baaScrollRef = useRef<HTMLDivElement>(null);
  const [termsScrolled, setTermsScrolled] = useState(false);
  const [baaScrolled, setBaaScrolled] = useState(false);

  useEffect(() => {
    const el = termsScrollRef.current;
    if (!el) return;
    function check() {
      if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setTermsScrolled(true);
    }
    check();
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, [signupStage]);

  useEffect(() => {
    const el = baaScrollRef.current;
    if (!el) return;
    function check() {
      if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setBaaScrolled(true);
    }
    check();
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, [signupStage]);

  const passwordGuidance = useMemo(() => buildMaskedPassword(signup.password), [signup.password]);
  const currentHeader = authHeader(mode, loginMfaSession, signupStage);
  const busy = status.kind === "busy";
  const isLegal = mode === "signup" && (signupStage === "terms" || signupStage === "baa");
  const isWizard = mode === "signup" && signupStage !== "account";

  async function routeAfterAuthentication(preferredPath?: string) {
    const profile = await getProfileStatus();
    if (profile.access.redirectPath) {
      router.replace(profile.access.redirectPath);
      return;
    }
    router.replace(preferredPath ?? props.initialNextPath);
  }

  async function maybeStartAuthenticatedMfaFlow() {
    const mfa = await getMfaStatus();
    if (!mfa.required || mfa.enabled || !mfa.manageable) {
      return false;
    }

    const setup = await startMfaSetup();
    const qrCodeDataUrl = await QRCode.toDataURL(setup.otpauthUri, {
      margin: 0,
      width: 220,
      color: {
        dark: "#4e1d77",
        light: "#ffffff",
      },
    });

    setPendingAuthSetup({
      flow: "authenticated",
      session: setup.session,
      secretCode: setup.secretCode,
      otpauthUri: setup.otpauthUri,
      qrCodeDataUrl,
    });
    setSignupStage("mfa");
    setMode("signup");
    setStatus({ kind: "idle" });
    return true;
  }

  async function finalizeSignupOnboarding() {
    const profile = await getProfileStatus();
    if (profile.access.gate === "require_org_selection") {
      if (signup.organizationAction === "create") {
        await setupOrganization({ action: "create", organizationName: signup.organizationName.trim() });
      } else {
        await setupOrganization({ action: "join", inviteCode: signup.inviteCode.trim().toUpperCase() });
      }
    }

    const afterOrg = await getProfileStatus();
    if (afterOrg.access.gate === "pending_org_join_approval") {
      router.replace("/onboarding");
      return;
    }

    if (!afterOrg.access.termsAccepted) {
      await acceptTerms(signup.legalName.trim());
    }

    const afterTerms = await getProfileStatus();
    if (!afterTerms.access.baaAccepted) {
      await acceptBaa(signup.legalName.trim());
    }

    const afterBaa = await getProfileStatus();
    if (!afterBaa.access.onboardingCompleted) {
      await completeOnboarding({
        legalName: signup.legalName.trim(),
        jobTitle: signup.jobTitle.trim(),
        phone: normalizePhoneNumber(signup.phone),
        organizationName: signup.organizationAction === "create" ? signup.organizationName.trim() : undefined,
      });
    }

    await routeAfterAuthentication("/app");
  }

  function resetTransientState() {
    setError(null);
    setStatus({ kind: "idle" });
  }

  async function handleAuthenticatedLogin(response: LoginResponse & { status: "authenticated" }) {
    setStatus({ kind: "busy", label: "Loading your workspace..." });
    try {
      const divertedToMfa = await maybeStartAuthenticatedMfaFlow();
      if (divertedToMfa) {
        return;
      }
      await routeAfterAuthentication(response.nextPath);
    } catch (authError) {
      setStatus({ kind: "idle" });
      setError(authError instanceof Error ? authError.message : "Unable to continue after sign-in.");
    }
  }

  async function onSubmitLogin(event: FormEvent) {
    event.preventDefault();
    resetTransientState();
    setStatus({ kind: "busy", label: "Signing you in..." });

    try {
      const result = await postJson<LoginResponse>("/api/auth/login", {
        email: loginEmail,
        password: loginPassword,
        rememberMe,
      });

      if (result.status === "authenticated") {
        await handleAuthenticatedLogin(result);
        return;
      }

      if (result.status === "mfa_required") {
        setLoginMfaEmail(result.email);
        setLoginMfaSession(result.session);
        setMode("login");
        setStatus({ kind: "success", message: `Enter the authenticator code for ${result.destination}.` });
        return;
      }

      if (result.status === "mfa_setup_required") {
        const setup = await postJson<{ secretCode: string; otpauthUri: string; session: string }>(
          "/api/auth/login/mfa/setup/start",
          { session: result.session, email: result.email },
          {
            headers: {
              "x-auth-email": result.email,
            },
          },
        );
        const qrCodeDataUrl = await QRCode.toDataURL(setup.otpauthUri, {
          margin: 0,
          width: 220,
          color: {
            dark: "#4e1d77",
            light: "#ffffff",
          },
        });
        setPendingChallengeSetup({
          flow: "challenge",
          email: result.email,
          session: setup.session,
          secretCode: setup.secretCode,
          otpauthUri: setup.otpauthUri,
          qrCodeDataUrl,
        });
        setSignupStage("mfa");
        setMode("signup");
        setStatus({ kind: "success", message: "Finish MFA enrollment to complete sign-in." });
        return;
      }

      if (result.status === "confirmation_required") {
        setSignup((current) => ({ ...current, email: result.email }));
        setMode("signup");
        setSignupStage("confirm");
        setStatus({ kind: "success", message: "Confirm your email to continue." });
        return;
      }
    } catch (authError) {
      setStatus({ kind: "idle" });
      setError(authError instanceof Error ? authError.message : "Unable to sign in.");
    }
  }

  async function onSubmitLoginMfa(event: FormEvent) {
    event.preventDefault();
    if (!loginMfaEmail || !loginMfaSession) {
      setError("Your sign-in session expired. Start again.");
      return;
    }

    resetTransientState();
    setStatus({ kind: "busy", label: "Verifying your code..." });
    try {
      const result = await postJson<LoginResponse & { status: "authenticated" }>("/api/auth/login/mfa", {
        email: loginMfaEmail,
        session: loginMfaSession,
        code: loginMfaCode,
        rememberMe,
      });
      setLoginMfaCode("");
      setLoginMfaSession(null);
      setLoginMfaEmail(null);
      await handleAuthenticatedLogin(result);
    } catch (authError) {
      setStatus({ kind: "idle" });
      setError(authError instanceof Error ? authError.message : "Unable to verify your MFA code.");
    }
  }

  function validateSignupStage() {
    if (signupStage === "account") {
      if (!signup.firstName.trim() || !signup.lastName.trim() || !signup.email.trim()) {
        return "First name, last name, and work email are required.";
      }
      const passwordError = buildMaskedPassword(signup.password);
      if (passwordError) {
        return passwordError;
      }
      if (signup.password !== signup.confirmPassword) {
        return "Passwords do not match.";
      }
      return null;
    }

    if (signupStage === "organization") {
      if (signup.organizationAction === "create" && !signup.organizationName.trim()) {
        return "Organization name is required.";
      }
      if (signup.organizationAction === "join" && !signup.inviteCode.trim()) {
        return "Invite code is required to join an organization.";
      }
      return null;
    }

    if (signupStage === "profile") {
      return null;
    }

    return null;
  }

  async function onAdvanceSignup(event: FormEvent) {
    event.preventDefault();
    resetTransientState();

    const validationError = validateSignupStage();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (signupStage === "terms") {
      setSignup((current) => ({ ...current, acceptTerms: true }));
      setSignupStage("baa");
      return;
    }

    if (signupStage === "baa") {
      setSignup((current) => ({ ...current, acceptBaa: true }));
      setStatus({ kind: "busy", label: "Creating your account..." });
      try {
        const result = await postJson<SignupResponse>("/api/auth/signup", {
          email: signup.email,
          password: signup.password,
          firstName: signup.firstName,
          lastName: signup.lastName,
        });

        if (result.userConfirmed) {
          setStatus({ kind: "success", message: "Account created. Completing secure sign-in..." });
          const loginResult = await postJson<LoginResponse>("/api/auth/login", {
            email: signup.email,
            password: signup.password,
            rememberMe: true,
          });
          if (loginResult.status === "authenticated") {
            const divertedToMfa = await maybeStartAuthenticatedMfaFlow();
            if (!divertedToMfa) {
              await finalizeSignupOnboarding();
            }
            return;
          }
        }

        setSignupStage("confirm");
        setResendCountdown(30);
        setStatus({
          kind: "success",
          message: `We sent a verification code to ${result.destination}.`,
        });
      } catch (signupError) {
        setStatus({ kind: "idle" });
        setError(signupError instanceof Error ? signupError.message : "Unable to create your account.");
      }
      return;
    }

    setSignupStage((current) => {
      if (current === "account") return "organization";
      if (current === "organization") return "profile";
      if (current === "profile") return "terms";
      return current;
    });
  }

  async function onConfirmSignUp(event: FormEvent) {
    event.preventDefault();
    resetTransientState();
    setStatus({ kind: "busy", label: "Confirming your account..." });
    try {
      await postJson("/api/auth/signup/confirm", {
        email: signup.email,
        code: confirmCode,
      });

      const loginResult = await postJson<LoginResponse>("/api/auth/login", {
        email: signup.email,
        password: signup.password,
        rememberMe: true,
      });

      if (loginResult.status === "authenticated") {
        const divertedToMfa = await maybeStartAuthenticatedMfaFlow();
        if (!divertedToMfa) {
          await finalizeSignupOnboarding();
        }
        return;
      }

      if (loginResult.status === "mfa_required") {
        setLoginMfaEmail(loginResult.email);
        setLoginMfaSession(loginResult.session);
        setMode("login");
        setStatus({ kind: "success", message: "Your account is confirmed. Enter your MFA code to continue." });
        return;
      }

      if (loginResult.status === "mfa_setup_required") {
        const setup = await postJson<{ secretCode: string; otpauthUri: string; session: string }>(
          "/api/auth/login/mfa/setup/start",
          { session: loginResult.session, email: loginResult.email },
          {
            headers: {
              "x-auth-email": loginResult.email,
            },
          },
        );
        const qrCodeDataUrl = await QRCode.toDataURL(setup.otpauthUri, {
          margin: 0,
          width: 220,
          color: {
            dark: "#4e1d77",
            light: "#ffffff",
          },
        });
        setPendingChallengeSetup({
          flow: "challenge",
          email: loginResult.email,
          session: setup.session,
          secretCode: setup.secretCode,
          otpauthUri: setup.otpauthUri,
          qrCodeDataUrl,
        });
        setSignupStage("mfa");
        setMode("signup");
        setStatus({ kind: "success", message: "Finish MFA enrollment to complete account activation." });
      }
    } catch (confirmError) {
      setStatus({ kind: "idle" });
      setError(confirmError instanceof Error ? confirmError.message : "Unable to confirm your account.");
    }
  }

  async function onResendCode() {
    resetTransientState();
    setStatus({ kind: "busy", label: "Resending code..." });
    try {
      await postJson("/api/auth/signup/resend", { email: signup.email });
      setResendCountdown(30);
      setStatus({ kind: "success", message: "A new verification code has been sent." });
    } catch (resendError) {
      setStatus({ kind: "idle" });
      setError(resendError instanceof Error ? resendError.message : "Unable to resend the verification code.");
    }
  }

  async function onSubmitForgotPassword(event: FormEvent) {
    event.preventDefault();
    resetTransientState();
    setStatus({ kind: "busy", label: "Sending reset code..." });
    try {
      await postJson("/api/auth/password/forgot", { email: forgotEmail });
      setResetEmail(forgotEmail.trim().toLowerCase());
      setMode("reset");
      setStatus({ kind: "success", message: "Check your email for a password reset code." });
    } catch (forgotError) {
      setStatus({ kind: "idle" });
      setError(forgotError instanceof Error ? forgotError.message : "Unable to start password reset.");
    }
  }

  async function onSubmitResetPassword(event: FormEvent) {
    event.preventDefault();
    resetTransientState();
    const passwordError = buildMaskedPassword(resetPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setStatus({ kind: "busy", label: "Updating password..." });
    try {
      await postJson("/api/auth/password/reset", {
        email: resetEmail,
        code: resetCode,
        newPassword: resetPassword,
      });
      setMode("login");
      setLoginEmail(resetEmail);
      setResetCode("");
      setResetPassword("");
      setStatus({ kind: "success", message: "Password updated. Sign in with your new password." });
    } catch (resetError) {
      setStatus({ kind: "idle" });
      setError(resetError instanceof Error ? resetError.message : "Unable to reset password.");
    }
  }

  async function onSubmitMfaSetup(event: FormEvent) {
    event.preventDefault();
    resetTransientState();
    setStatus({ kind: "busy", label: "Finalizing security setup..." });

    try {
      if (pendingChallengeSetup) {
        await postJson<LoginResponse & { status: "authenticated" }>("/api/auth/login/mfa/setup/verify", {
          email: pendingChallengeSetup.email,
          session: pendingChallengeSetup.session,
          code: mfaSetupCode,
          rememberMe: true,
        });
      } else if (pendingAuthSetup) {
        await verifyMfaSetup({ code: mfaSetupCode, session: pendingAuthSetup.session });
      } else {
        throw new Error("No MFA setup is currently in progress.");
      }

      setPendingAuthSetup(null);
      setPendingChallengeSetup(null);
      setMfaSetupCode("");

      if (signup.email) {
        await finalizeSignupOnboarding();
      } else {
        await routeAfterAuthentication("/app");
      }
    } catch (mfaError) {
      setStatus({ kind: "idle" });
      setError(mfaError instanceof Error ? mfaError.message : "Unable to finish MFA setup.");
    }
  }

  return (
    <AuthShell>
      <div
        className="w-full transition-all duration-300 ease-in-out"
        style={{ maxWidth: isLegal ? "75vw" : isWizard ? "560px" : "440px" }}
      >
        <AuthCard>
          <div className="space-y-5">
            <div className="flex justify-center pb-1">
              <img src="/overture-logo.png" alt="Overture" className="h-8 w-auto" />
            </div>

            <div className="space-y-3">
              <AuthKicker>{currentHeader.kicker}</AuthKicker>
              <AuthHeading title={currentHeader.title} body={currentHeader.body} />
            </div>

            {status.kind === "success" ? (
              <div aria-live="polite">
                <AuthAlert tone="success">{status.message}</AuthAlert>
              </div>
            ) : null}
            {error ? (
              <div aria-live="polite">
                <AuthAlert tone="error">{error}</AuthAlert>
              </div>
            ) : null}

            {mode === "login" ? (
              <form className="space-y-4" onSubmit={loginMfaSession ? onSubmitLoginMfa : onSubmitLogin}>
                {!loginMfaSession ? (
                  <>
                    <AuthField label="Work email">
                      <AuthInput
                        type="email"
                        autoComplete="email"
                        value={loginEmail}
                        onChange={(event) => setLoginEmail(event.target.value)}
                        placeholder="you@organization.com"
                      />
                    </AuthField>

                    <AuthField label="Password">
                      <div className="relative">
                        <AuthInput
                          type={showLoginPassword ? "text" : "password"}
                          autoComplete="current-password"
                          value={loginPassword}
                          onChange={(event) => setLoginPassword(event.target.value)}
                          placeholder="Enter your password"
                          className="pr-20"
                        />
                        <PasswordToggle visible={showLoginPassword} onToggle={() => setShowLoginPassword((value) => !value)} />
                      </div>
                    </AuthField>

                    <div className="flex items-center justify-between gap-3">
                      <AuthCheckbox checked={rememberMe} onChange={setRememberMe} label="Keep me signed in" />
                      <AuthLinkButton
                        type="button"
                        onClick={() => {
                          resetTransientState();
                          setForgotEmail(loginEmail);
                          setMode("forgot");
                        }}
                      >
                        Forgot password?
                      </AuthLinkButton>
                    </div>
                  </>
                ) : (
                  <>
                    <AuthSectionNote>
                      Use the current code from your authenticator app{loginMfaEmail ? ` for ${loginMfaEmail}` : ""}.
                    </AuthSectionNote>
                    <AuthField label="Authenticator code">
                      <AuthInput
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={loginMfaCode}
                        onChange={(event) => setLoginMfaCode(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                        placeholder="000000"
                      />
                    </AuthField>
                  </>
                )}

                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" disabled={busy} className="w-full">
                    {busy ? status.label : loginMfaSession ? "Verify and continue" : "Sign in"}
                  </AuthPrimaryButton>

                  {!loginMfaSession ? (
                    <div className="text-center">
                      <AuthLinkButton
                        type="button"
                        onClick={() => {
                          resetTransientState();
                          setMode("signup");
                          setSignupStage("account");
                        }}
                      >
                        Create account
                      </AuthLinkButton>
                    </div>
                  ) : (
                    <AuthSecondaryButton
                      type="button"
                      className="w-full"
                      onClick={() => {
                        setLoginMfaSession(null);
                        setLoginMfaEmail(null);
                        setLoginMfaCode("");
                        resetTransientState();
                      }}
                    >
                      Back to password
                    </AuthSecondaryButton>
                  )}
                </div>
              </form>
            ) : null}

            {mode === "forgot" ? (
              <form className="space-y-4" onSubmit={onSubmitForgotPassword}>
                <AuthField label="Account email" hint="We send a one-time reset code to this address.">
                  <AuthInput
                    type="email"
                    autoComplete="email"
                    value={forgotEmail}
                    onChange={(event) => setForgotEmail(event.target.value)}
                    placeholder="you@organization.com"
                  />
                </AuthField>

                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" disabled={busy} className="w-full">
                    {busy ? status.label : "Send reset code"}
                  </AuthPrimaryButton>
                  <div className="text-center">
                    <AuthLinkButton
                      type="button"
                      onClick={() => {
                        resetTransientState();
                        setMode("login");
                      }}
                    >
                      Back to sign in
                    </AuthLinkButton>
                  </div>
                </div>
              </form>
            ) : null}

            {mode === "reset" ? (
              <form className="space-y-4" onSubmit={onSubmitResetPassword}>
                <AuthField label="Account email">
                  <AuthInput type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} />
                </AuthField>

                <AuthField label="Verification code">
                  <AuthInput
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={resetCode}
                    onChange={(event) => setResetCode(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Enter the code from your email"
                  />
                </AuthField>

                <AuthField label="New password" hint="Use at least 12 characters, including upper, lower, and a number.">
                  <div className="relative">
                    <AuthInput
                      type={showResetPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={resetPassword}
                      onChange={(event) => setResetPassword(event.target.value)}
                      placeholder="Create a new password"
                      className="pr-20"
                    />
                    <PasswordToggle visible={showResetPassword} onToggle={() => setShowResetPassword((value) => !value)} />
                  </div>
                </AuthField>

                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" disabled={busy} className="w-full">
                    {busy ? status.label : "Update password"}
                  </AuthPrimaryButton>
                  <div className="text-center">
                    <AuthLinkButton
                      type="button"
                      onClick={() => {
                        resetTransientState();
                        setMode("login");
                      }}
                    >
                      Back to sign in
                    </AuthLinkButton>
                  </div>
                </div>
              </form>
            ) : null}

            {mode === "signup" && signupStage === "account" ? (
              <form className="space-y-4" onSubmit={onAdvanceSignup}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <AuthField label="First name">
                    <AuthInput value={signup.firstName} onChange={(event) => setSignup((current) => ({ ...current, firstName: event.target.value }))} />
                  </AuthField>
                  <AuthField label="Last name">
                    <AuthInput value={signup.lastName} onChange={(event) => setSignup((current) => ({ ...current, lastName: event.target.value }))} />
                  </AuthField>
                </div>

                <AuthField label="Work email">
                  <AuthInput
                    type="email"
                    autoComplete="email"
                    value={signup.email}
                    onChange={(event) => setSignup((current) => ({ ...current, email: event.target.value }))}
                    placeholder="you@organization.com"
                  />
                </AuthField>

                <AuthField label="Password" hint={passwordGuidance ?? "At least 12 characters, upper, lower, and a number."}>
                  <AuthInput
                    type="password"
                    autoComplete="new-password"
                    value={signup.password}
                    onChange={(event) => setSignup((current) => ({ ...current, password: event.target.value }))}
                  />
                </AuthField>

                <AuthField label="Confirm password">
                  <AuthInput
                    type="password"
                    autoComplete="new-password"
                    value={signup.confirmPassword}
                    onChange={(event) => setSignup((current) => ({ ...current, confirmPassword: event.target.value }))}
                  />
                </AuthField>

                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" className="w-full">
                    Continue
                  </AuthPrimaryButton>
                  <div className="text-center">
                    <AuthLinkButton
                      type="button"
                      onClick={() => {
                        resetTransientState();
                        setMode("login");
                      }}
                    >
                      Back to sign in
                    </AuthLinkButton>
                  </div>
                </div>
              </form>
            ) : null}

            {mode === "signup" && signupStage === "organization" ? (
              <form className="space-y-4" onSubmit={onAdvanceSignup}>
                <div className="grid gap-3">
                  <ChoiceCard
                    active={signup.organizationAction === "create"}
                    title="Create an organization"
                    body="Use this if you are setting up the first admin account for your team."
                    onClick={() => setSignup((current) => ({ ...current, organizationAction: "create" }))}
                  />
                  <ChoiceCard
                    active={signup.organizationAction === "join"}
                    title="Join an existing organization"
                    body="Use an invite code provided by your organization administrator."
                    onClick={() => setSignup((current) => ({ ...current, organizationAction: "join" }))}
                  />
                </div>

                {signup.organizationAction === "create" ? (
                  <AuthField label="Organization name" hint="This becomes the initial organization owner account.">
                    <AuthInput
                      value={signup.organizationName}
                      onChange={(event) => setSignup((current) => ({ ...current, organizationName: event.target.value }))}
                      placeholder="Example Oncology Associates"
                    />
                  </AuthField>
                ) : (
                  <AuthField label="Invite code" hint="Join requests remain pending until an organization admin approves access.">
                    <AuthInput
                      value={signup.inviteCode}
                      onChange={(event) => setSignup((current) => ({ ...current, inviteCode: event.target.value.toUpperCase() }))}
                      placeholder="ORG-ACCESS-CODE"
                    />
                  </AuthField>
                )}

                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" className="w-full">
                    Continue
                  </AuthPrimaryButton>
                  <AuthSecondaryButton type="button" className="w-full" onClick={() => setSignupStage("account")}>
                    Back
                  </AuthSecondaryButton>
                </div>
              </form>
            ) : null}

            {mode === "signup" && signupStage === "profile" ? (
              <form className="space-y-4" onSubmit={onAdvanceSignup}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <AuthField label="Job title">
                    <AuthInput
                      value={signup.jobTitle}
                      onChange={(event) => setSignup((current) => ({ ...current, jobTitle: event.target.value }))}
                      placeholder="Medical Director"
                    />
                  </AuthField>
                  <AuthField label="Phone number">
                    <AuthInput
                      type="tel"
                      inputMode="tel"
                      value={signup.phone}
                      onChange={(event) =>
                        setSignup((current) => ({ ...current, phone: formatPhoneDisplay(event.target.value) }))
                      }
                      placeholder="(312) 555-0148"
                    />
                  </AuthField>
                </div>

                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" className="w-full">
                    Continue
                  </AuthPrimaryButton>
                  <AuthSecondaryButton type="button" className="w-full" onClick={() => setSignupStage("organization")}>
                    Back
                  </AuthSecondaryButton>
                </div>
              </form>
            ) : null}

            {mode === "signup" && signupStage === "terms" ? (
              <form className="space-y-4" onSubmit={onAdvanceSignup}>
                <div
                  ref={termsScrollRef}
                  className="max-h-[260px] overflow-y-auto rounded-[18px] border border-[#e5dde9] bg-[#fcfbfd] px-5 py-4 text-[13px] leading-7 text-[#61556d]"
                >
                  <div className="space-y-3">
                    {TERMS_OF_USE_COPY.map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  </div>
                </div>
                {!termsScrolled ? (
                  <p className="text-center text-[12px] text-[#998aa8]">Scroll to the bottom to accept</p>
                ) : null}
                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" disabled={!termsScrolled} className="w-full">
                    Accept Terms of Use
                  </AuthPrimaryButton>
                  <AuthSecondaryButton type="button" className="w-full" onClick={() => setSignupStage("profile")}>
                    Back
                  </AuthSecondaryButton>
                </div>
              </form>
            ) : null}

            {mode === "signup" && signupStage === "baa" ? (
              <form className="space-y-4" onSubmit={onAdvanceSignup}>
                <div
                  ref={baaScrollRef}
                  className="max-h-[260px] overflow-y-auto rounded-[18px] border border-[#e5dde9] bg-[#fcfbfd] px-5 py-4 text-[13px] leading-7 text-[#61556d]"
                >
                  <div className="space-y-3">
                    {BAA_COPY.map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  </div>
                </div>
                {!baaScrolled ? (
                  <p className="text-center text-[12px] text-[#998aa8]">Scroll to the bottom to accept</p>
                ) : null}
                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" disabled={busy || !baaScrolled} className="w-full">
                    {busy ? status.label : "Accept BAA & Create Account"}
                  </AuthPrimaryButton>
                  <AuthSecondaryButton type="button" className="w-full" onClick={() => setSignupStage("terms")}>
                    Back
                  </AuthSecondaryButton>
                </div>
              </form>
            ) : null}

            {mode === "signup" && signupStage === "confirm" ? (
              <form className="space-y-4" onSubmit={onConfirmSignUp}>
                <AuthSectionNote>
                  We sent a verification code to <span className="font-medium text-[#43364f]">{signup.email || "your email address"}</span>.
                </AuthSectionNote>

                <AuthField label="Verification code">
                  <AuthInput
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={confirmCode}
                    onChange={(event) => setConfirmCode(event.target.value.replace(/[^\d]/g, ""))}
                    placeholder="000000"
                  />
                </AuthField>

                <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
                  <AuthLinkButton type="button" onClick={() => void onResendCode()} disabled={resendCountdown > 0}>
                    {resendCountdown > 0 ? `Resend available in ${resendCountdown}s` : "Resend code"}
                  </AuthLinkButton>
                  <AuthLinkButton type="button" onClick={() => setSignupStage("baa")}>
                    Back to account details
                  </AuthLinkButton>
                </div>

                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" disabled={busy} className="w-full">
                    {busy ? status.label : "Verify and continue"}
                  </AuthPrimaryButton>
                  <div className="text-center">
                    <AuthLinkButton
                      type="button"
                      onClick={() => {
                        resetTransientState();
                        setMode("login");
                        setLoginEmail(signup.email);
                      }}
                    >
                      Sign in instead
                    </AuthLinkButton>
                  </div>
                </div>
              </form>
            ) : null}

            {mode === "signup" && signupStage === "mfa" ? (
              <form className="space-y-4" onSubmit={onSubmitMfaSetup}>
                <AuthSectionNote>
                  Scan the code below with your authenticator app, then enter the current 6-digit code to complete setup.
                </AuthSectionNote>

                <div className="grid gap-4">
                  <div className="rounded-[20px] border border-[#e6dfeb] bg-white p-4">
                    {pendingChallengeSetup?.qrCodeDataUrl || pendingAuthSetup?.qrCodeDataUrl ? (
                      <img
                        src={pendingChallengeSetup?.qrCodeDataUrl ?? pendingAuthSetup?.qrCodeDataUrl}
                        alt="Authenticator QR code"
                        className="mx-auto h-[220px] w-[220px]"
                      />
                    ) : null}
                  </div>

                  <div className="rounded-[20px] border border-[#e7dfea] bg-[#faf8fb] p-4">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#7d7188]">Manual setup code</p>
                    <p className="mt-2 break-all font-mono text-[13px] tracking-[0.18em] text-[#4f3f60]">
                      {pendingChallengeSetup?.secretCode ?? pendingAuthSetup?.secretCode}
                    </p>
                  </div>

                  <AuthField label="Authenticator code">
                    <AuthInput
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={mfaSetupCode}
                      onChange={(event) => setMfaSetupCode(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                      placeholder="000000"
                    />
                  </AuthField>
                </div>

                <div className="space-y-3 pt-1">
                  <AuthPrimaryButton type="submit" disabled={busy} className="w-full">
                    {busy ? status.label : "Complete security setup"}
                  </AuthPrimaryButton>
                  <AuthSecondaryButton
                    type="button"
                    className="w-full"
                    onClick={() => {
                      setPendingAuthSetup(null);
                      setPendingChallengeSetup(null);
                      setMfaSetupCode("");
                      setSignupStage("confirm");
                    }}
                  >
                    Back
                  </AuthSecondaryButton>
                </div>
              </form>
            ) : null}
          </div>
        </AuthCard>
      </div>
    </AuthShell>
  );
}
