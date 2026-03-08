import { createHash, randomBytes } from "node:crypto";
import { optionalEnv, requireEnv } from "@/lib/env";

const STATE_COOKIE = "oauth_state";
const VERIFIER_COOKIE = "oauth_verifier";
const NEXT_COOKIE = "oauth_next";

export function authFlowCookies() {
  return {
    state: STATE_COOKIE,
    verifier: VERIFIER_COOKIE,
    next: NEXT_COOKIE,
  };
}

function toBase64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkcePair() {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createState() {
  return toBase64Url(randomBytes(24));
}

export function normalizeNextPath(input: string | null | undefined, fallback = "/app") {
  if (!input || input.length === 0) {
    return fallback;
  }
  if (!input.startsWith("/")) {
    return fallback;
  }
  if (input.startsWith("//")) {
    return fallback;
  }
  return input;
}

function getHostedDomainBase() {
  const raw = optionalEnv("COGNITO_HOSTED_UI_DOMAIN");
  if (!raw) {
    throw new Error("Missing required environment variable: COGNITO_HOSTED_UI_DOMAIN");
  }

  return raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
}

export function getHostedAuthConfig(origin: string) {
  const domainBase = getHostedDomainBase();
  const clientId = requireEnv("COGNITO_APP_CLIENT_ID");
  const redirectUri = `${origin}/auth/callback`;

  return {
    clientId,
    redirectUri,
    authorizeUrl: `${domainBase}/oauth2/authorize`,
    tokenUrl: `${domainBase}/oauth2/token`,
    logoutUrl: `${domainBase}/logout`,
  };
}

export function secureCookieForOrigin(origin: string) {
  return origin.startsWith("https://");
}

export function getRequestOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host");
  if (host) {
    const protocol = forwardedProto ?? new URL(request.url).protocol.replace(":", "");
    return `${protocol}://${host}`;
  }
  return new URL(request.url).origin;
}
