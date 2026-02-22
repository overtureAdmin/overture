import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { optionalEnv, requireEnv } from "@/lib/env";
import { jsonError } from "@/lib/http";

type CognitoClaims = JWTPayload & {
  token_use?: "id" | "access";
  sub?: string;
  email?: string;
  aud?: string;
  client_id?: string;
  "custom:tenant_id"?: string;
  tenant_id?: string;
};

export type AuthContext = {
  tenantId: string;
  userSub: string;
  email: string | null;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let issuerCache: string | null = null;

function getIssuer(): string {
  const region = optionalEnv("COGNITO_REGION") ?? optionalEnv("AWS_REGION") ?? "us-east-1";
  const userPoolId = requireEnv("COGNITO_USER_POOL_ID");
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

function getJwks() {
  const issuer = getIssuer();
  if (!jwks || issuerCache !== issuer) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    issuerCache = issuer;
  }
  return jwks;
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return authorization.slice(7).trim();
}

async function verifyCognitoToken(token: string): Promise<CognitoClaims | null> {
  let appClientId: string;
  let issuer: string;
  try {
    appClientId = requireEnv("COGNITO_APP_CLIENT_ID");
    issuer = getIssuer();
  } catch {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer,
    });
    const claims = payload as CognitoClaims;
    if (!claims.sub || typeof claims.sub !== "string") {
      return null;
    }
    if (claims.token_use !== "id" && claims.token_use !== "access") {
      return null;
    }
    if (claims.token_use === "id" && claims.aud !== appClientId) {
      return null;
    }
    if (claims.token_use === "access" && claims.client_id !== appClientId) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

async function parseClaimsFromAuthHeader(request: Request): Promise<AuthContext | null> {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const claims = await verifyCognitoToken(token);
  if (!claims) {
    return null;
  }

  const tenantValue = claims["custom:tenant_id"] ?? claims.tenant_id;
  const subValue = claims.sub;
  if (typeof tenantValue !== "string" || tenantValue.length === 0) {
    return null;
  }
  if (typeof subValue !== "string" || subValue.length === 0) {
    return null;
  }

  return {
    tenantId: tenantValue,
    userSub: subValue,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}

export async function getAuthContextOrDevFallback(request: Request): Promise<AuthContext | null> {
  const parsed = await parseClaimsFromAuthHeader(request);
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
