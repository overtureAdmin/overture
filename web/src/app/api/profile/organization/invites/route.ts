import { randomBytes } from "node:crypto";
import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { denyIfNoPermission } from "@/lib/access";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type InviteBody = {
  defaultRole?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  expiresInDays?: number;
  maxUses?: number;
};

function generateInviteCode() {
  return `UHT-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const deny = denyIfNoPermission(actor, "org:manage");
    if (deny) {
      return deny;
    }
    const result = await db.query<{
      id: string;
      code: string;
      default_role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
      expires_at: string;
      max_uses: number;
      used_count: number;
      status: "active" | "disabled";
    }>(
      `
        SELECT id, code, default_role, expires_at, max_uses, used_count, status
        FROM organization_invite_code
        WHERE organization_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 25
      `,
      [actor.organizationId],
    );
    return jsonOk({
      invites: result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        defaultRole: row.default_role,
        expiresAt: row.expires_at,
        maxUses: row.max_uses,
        usedCount: row.used_count,
        status: row.status,
      })),
    });
  } catch (error) {
    console.error("GET /api/profile/organization/invites failed", error);
    return jsonError("Failed to load organization invites", 500);
  }
}

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = (await parseJsonBody<InviteBody>(request)) ?? {};
  const defaultRole = body.defaultRole ?? "case_contributor";
  const expiresInDays = Math.max(1, Math.min(30, body.expiresInDays ?? 7));
  const maxUses = Math.max(1, Math.min(500, body.maxUses ?? 25));

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    const deny = denyIfNoPermission(actor, "org:manage");
    if (deny) {
      await client.query("ROLLBACK");
      return deny;
    }
    const code = generateInviteCode();
    const insertResult = await client.query<{
      id: string;
      code: string;
      default_role: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
      expires_at: string;
      max_uses: number;
      used_count: number;
      status: "active" | "disabled";
    }>(
      `
        INSERT INTO organization_invite_code (organization_id, code, default_role, expires_at, max_uses, created_by_subject)
        VALUES ($1::uuid, $2, $3, NOW() + ($4 || ' days')::interval, $5, $6)
        RETURNING id, code, default_role, expires_at, max_uses, used_count, status
      `,
      [actor.organizationId, code, defaultRole, expiresInDays, maxUses, auth.userSub],
    );
    await client.query("COMMIT");
    const row = insertResult.rows[0];
    return jsonOk({
      invite: {
        id: row.id,
        code: row.code,
        defaultRole: row.default_role,
        expiresAt: row.expires_at,
        maxUses: row.max_uses,
        usedCount: row.used_count,
        status: row.status,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/profile/organization/invites failed", error);
    return jsonError("Failed to create invite", 500);
  } finally {
    client.release();
  }
}
