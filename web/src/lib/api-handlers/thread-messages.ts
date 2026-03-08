
type Actor = {
  tenantId: string;
  userId: string;
  role?: "org_owner" | "org_admin" | "case_contributor" | "reviewer" | "read_only";
  baaAccepted?: boolean;
  onboardingCompleted?: boolean;
  organizationStatus?: "verified" | "pending_verification" | "suspended";
  organizationType?: "solo" | "enterprise";
  subscriptionStatus?: "trialing" | "active" | "past_due" | "canceled" | "none";
};

type SqlClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
};

type SqlPool = {
  connect: () => Promise<SqlClient>;
};

export type ThreadMessagesDeps = {
  getAuthContext: (request: Request) => Promise<{ tokenTenantId?: string | null; tenantId?: string; userSub: string; email: string | null } | null>;
  authRequiredResponse: () => Response;
  jsonError: (message: string, status?: number) => Response;
  jsonOk: (payload: unknown, status?: number) => Response;
  getDbPool: () => SqlPool;
  ensureTenantAndUser: (
    db: SqlClient,
    auth: { tokenTenantId?: string | null; tenantId?: string; userSub: string; email: string | null },
  ) => Promise<Actor>;
};

export type ThreadMessagesRouteParams = {
  params: Promise<{ threadId: string }>;
};

export function createThreadMessagesHandler(deps: ThreadMessagesDeps) {
  return async function handleThreadMessages(request: Request, { params }: ThreadMessagesRouteParams) {
    const auth = await deps.getAuthContext(request);
    if (!auth) {
      return deps.authRequiredResponse();
    }

    const { threadId } = await params;
    const db = deps.getDbPool();
    const client = await db.connect();

    try {
      const actor = await deps.ensureTenantAndUser(client, auth);
      const threadResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM thread
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
          LIMIT 1
        `,
        [threadId, actor.tenantId],
      );

      if (!threadResult.rows[0]) {
        return deps.jsonError("Thread not found", 404);
      }

      const messagesResult = await client.query<{
        id: string;
        role: "user" | "assistant" | "system";
        content: string;
        created_at: string;
      }>(
        `
          SELECT id, role, content, created_at
          FROM message
          WHERE thread_id = $1::uuid
            AND tenant_id = $2::uuid
          ORDER BY created_at ASC
          LIMIT 200
        `,
        [threadId, actor.tenantId],
      );

      return deps.jsonOk({
        messages: messagesResult.rows.map((row) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          createdAt: row.created_at,
        })),
      });
    } catch (_error) {
      return deps.jsonError("Failed to load messages", 500);
    } finally {
      client.release();
    }
  };
}
