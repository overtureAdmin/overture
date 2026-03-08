
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

export type DocumentDetailDeps = {
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

export type DocumentDetailRouteParams = {
  params: Promise<{ id: string }>;
};

export function createDocumentDetailHandler(deps: DocumentDetailDeps) {
  return async function handleDocumentDetail(request: Request, { params }: DocumentDetailRouteParams) {
    const auth = await deps.getAuthContext(request);
    if (!auth) {
      return deps.authRequiredResponse();
    }

    const { id } = await params;
    const db = deps.getDbPool();
    const client = await db.connect();

    try {
      const actor = await deps.ensureTenantAndUser(client, auth);
      const documentResult = await client.query<{
        id: string;
        thread_id: string;
        kind: "lmn" | "appeal" | "p2p";
        version: number;
        content: string;
        created_at: string;
      }>(
        `
          SELECT id, thread_id, kind, version, content, created_at
          FROM generated_document
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
          LIMIT 1
        `,
        [id, actor.tenantId],
      );

      const document = documentResult.rows[0];
      if (!document) {
        return deps.jsonError("Document not found", 404);
      }

      return deps.jsonOk({
        document: {
          id: document.id,
          threadId: document.thread_id,
          kind: document.kind,
          version: document.version,
          content: document.content,
          createdAt: document.created_at,
        },
      });
    } catch (_error) {
      return deps.jsonError("Failed to load document", 500);
    } finally {
      client.release();
    }
  };
}
