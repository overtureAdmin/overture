import { Pool, PoolClient } from "pg";
import { AuthContext } from "@/lib/auth";

export type ResolvedActor = {
  tenantId: string;
  userId: string;
};

export async function ensureTenantAndUser(
  db: Pool | PoolClient,
  auth: AuthContext,
): Promise<ResolvedActor> {
  await db.query(
    `
      INSERT INTO tenant (id, slug, name)
      VALUES ($1::uuid, $2, $3)
      ON CONFLICT (id) DO NOTHING
    `,
    [auth.tenantId, auth.tenantId, auth.tenantId],
  );

  await db.query(
    `
      INSERT INTO app_user (tenant_id, auth_subject, email)
      VALUES ($1::uuid, $2, $3)
      ON CONFLICT (tenant_id, auth_subject)
      DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
    `,
    [auth.tenantId, auth.userSub, auth.email],
  );

  const userResult = await db.query<{ id: string }>(
    `
      SELECT id
      FROM app_user
      WHERE tenant_id = $1::uuid
        AND auth_subject = $2
      LIMIT 1
    `,
    [auth.tenantId, auth.userSub],
  );

  if (!userResult.rows[0]?.id) {
    throw new Error("Unable to resolve user record");
  }

  return {
    tenantId: auth.tenantId,
    userId: userResult.rows[0].id,
  };
}

export async function insertAuditEvent(
  db: Pool | PoolClient,
  params: {
    tenantId: string;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.query(
    `
      INSERT INTO audit_event (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb)
    `,
    [
      params.tenantId,
      params.actorUserId ?? null,
      params.action,
      params.entityType,
      params.entityId ?? null,
      JSON.stringify(params.metadata ?? {}),
    ],
  );
}
