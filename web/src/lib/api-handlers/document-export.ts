
type ExportBody = {
  format: "docx" | "pdf";
};

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

export type DocumentExportDeps = {
  getAuthContext: (request: Request) => Promise<{ tokenTenantId?: string | null; tenantId?: string; userSub: string; email: string | null } | null>;
  authRequiredResponse: () => Response;
  parseJsonBody: <T>(request: Request) => Promise<T | null>;
  jsonError: (message: string, status?: number) => Response;
  jsonOk: (payload: unknown, status?: number) => Response;
  getDbPool: () => SqlPool;
  ensureTenantAndUser: (
    db: SqlClient,
    auth: { tokenTenantId?: string | null; tenantId?: string; userSub: string; email: string | null },
  ) => Promise<Actor>;
  insertAuditEvent: (
    db: SqlClient,
    params: {
      tenantId: string;
      actorUserId: string;
      action: string;
      entityType: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<void>;
};

export type DocumentExportRouteParams = {
  params: Promise<{ id: string }>;
};

export function createDocumentExportHandler(deps: DocumentExportDeps) {
  return async function handleDocumentExport(request: Request, { params }: DocumentExportRouteParams) {
    const auth = await deps.getAuthContext(request);
    if (!auth) {
      return deps.authRequiredResponse();
    }

    const body = await deps.parseJsonBody<ExportBody>(request);
    if (!body || !["docx", "pdf"].includes(body.format)) {
      return deps.jsonError("Missing required field: format (docx|pdf)", 422);
    }

    const format = body.format;
    const { id } = await params;
    const db = deps.getDbPool();
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      const actor = await deps.ensureTenantAndUser(client, auth);
      const documentResult = await client.query<{
        id: string;
        thread_id: string;
        kind: "lmn" | "appeal" | "p2p";
        version: number;
      }>(
        `
          SELECT id, thread_id, kind, version
          FROM generated_document
          WHERE id = $1::uuid
            AND tenant_id = $2::uuid
          LIMIT 1
        `,
        [id, actor.tenantId],
      );
      const document = documentResult.rows[0];
      if (!document?.id) {
        await client.query("ROLLBACK");
        return deps.jsonError("Document not found", 404);
      }

      const exportResult = await client.query<{
        id: string;
        status: string;
        created_at: string;
      }>(
        `
          INSERT INTO generated_document_export (
            tenant_id,
            generated_document_id,
            requested_by_user_id,
            format,
            status
          )
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'queued')
          RETURNING id, status, created_at
        `,
        [actor.tenantId, id, actor.userId, format],
      );
      const exportRecord = exportResult.rows[0];

      await deps.insertAuditEvent(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "document.export.requested",
        entityType: "generated_document",
        entityId: id,
        metadata: {
          outcome: "queued",
          threadId: document.thread_id,
          documentId: id,
          kind: document.kind,
          version: document.version,
          modelId: null,
          phiProcessingEnabled: false,
          exportId: exportRecord.id,
          format,
          status: exportRecord.status,
        },
      });

      await client.query("COMMIT");
      return deps.jsonOk(
        {
          documentId: id,
          format,
          exportId: exportRecord.id,
          status: exportRecord.status,
          createdAt: exportRecord.created_at,
          statusUrl: `/api/documents/${id}/export/${exportRecord.id}`,
        },
        201,
      );
    } catch (_error) {
      await client.query("ROLLBACK");
      return deps.jsonError("Failed to queue export", 500);
    } finally {
      client.release();
    }
  };
}
