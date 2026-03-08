
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

export type ThreadDocumentsDeps = {
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

export type ThreadDocumentsRouteParams = {
  params: Promise<{ threadId: string }>;
};

export function createThreadDocumentsHandler(deps: ThreadDocumentsDeps) {
  return async function handleThreadDocuments(request: Request, { params }: ThreadDocumentsRouteParams) {
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

      const documentsResult = await client.query<{
        id: string;
        thread_id: string;
        kind: "lmn" | "appeal" | "p2p";
        version: number;
        created_at: string;
      }>(
        `
          SELECT id, thread_id, kind, version, created_at
          FROM generated_document
          WHERE thread_id = $1::uuid
            AND tenant_id = $2::uuid
          ORDER BY created_at DESC
          LIMIT 100
        `,
        [threadId, actor.tenantId],
      );

      return deps.jsonOk({
        documents: documentsResult.rows.map((row) => ({
          id: row.id,
          threadId: row.thread_id,
          kind: row.kind,
          version: row.version,
          createdAt: row.created_at,
        })),
      });
    } catch (_error) {
      return deps.jsonError("Failed to load documents", 500);
    } finally {
      client.release();
    }
  };
}
