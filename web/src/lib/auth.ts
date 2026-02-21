import { jsonError } from "@/lib/http";

export type AuthContext = {
  tenantId: string;
  userSub: string;
  email: string | null;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4 || 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseClaimsFromAuthHeader(request: Request): AuthContext | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }

  const tenantValue = payload["custom:tenant_id"] ?? payload.tenant_id;
  const subValue = payload.sub;
  if (typeof tenantValue !== "string" || tenantValue.length === 0) {
    return null;
  }
  if (typeof subValue !== "string" || subValue.length === 0) {
    return null;
  }

  return {
    tenantId: tenantValue,
    userSub: subValue,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}

export function getAuthContextOrDevFallback(request: Request): AuthContext | null {
  const parsed = parseClaimsFromAuthHeader(request);
  if (parsed) {
    return parsed;
  }

  if (process.env.NODE_ENV !== "production" && process.env.DEV_BYPASS_AUTH === "true") {
    return {
      tenantId: process.env.DEV_TENANT_ID ?? "00000000-0000-0000-0000-000000000001",
      userSub: process.env.DEV_USER_SUB ?? "dev-user",
      email: process.env.DEV_USER_EMAIL ?? "dev@example.com",
    };
  }

  return null;
}

export function authRequiredResponse() {
  return jsonError("Unauthorized: missing or invalid bearer token", 401);
}
