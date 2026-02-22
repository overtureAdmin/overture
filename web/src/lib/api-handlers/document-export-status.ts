type ExportStatusRecord = {
  id: string;
  generated_document_id: string;
  format: "docx" | "pdf";
  status: "queued" | "processing" | "completed" | "failed";
  storage_key: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type Actor = {
  tenantId: string;
  userId: string;
};

type SqlClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
};

type SqlPool = {
  connect: () => Promise<SqlClient>;
};

export type DocumentExportStatusDeps = {
  getAuthContext: (request: Request) => Promise<{ tenantId: string; userSub: string; email: string | null } | null>;
  authRequiredResponse: () => Response;
  jsonError: (message: string, status?: number) => Response;
  jsonOk: (payload: unknown, status?: number) => Response;
  getDbPool: () => SqlPool;
  ensureTenantAndUser: (
    db: SqlClient,
    auth: { tenantId: string; userSub: string; email: string | null },
  ) => Promise<Actor>;
  buildExportStatusPayload: (
    record: ExportStatusRecord,
    createDownloadUrl: (params: { key: string; fileName: string; expiresInSeconds: number }) => Promise<string>,
  ) => Promise<unknown>;
  createDownloadUrl: (params: { key: string; fileName: string; expiresInSeconds: number }) => Promise<string>;
};

export type DocumentExportStatusRouteParams = {
  params: Promise<{ id: string; exportId: string }>;
};

export function createDocumentExportStatusHandler(deps: DocumentExportStatusDeps) {
  return async function handleDocumentExportStatus(request: Request, { params }: DocumentExportStatusRouteParams) {
    const auth = await deps.getAuthContext(request);
    if (!auth) {
      return deps.authRequiredResponse();
    }

    const { id, exportId } = await params;
    const db = deps.getDbPool();
    const client = await db.connect();

    try {
      const actor = await deps.ensureTenantAndUser(client, auth);
      const exportResult = await client.query<ExportStatusRecord>(
        `
          SELECT id, generated_document_id, format, status, storage_key, error_message, created_at, updated_at
          FROM generated_document_export
          WHERE id = $1::uuid
            AND generated_document_id = $2::uuid
            AND tenant_id = $3::uuid
          LIMIT 1
        `,
        [exportId, id, actor.tenantId],
      );

      const record = exportResult.rows[0];
      if (!record) {
        return deps.jsonError("Export not found", 404);
      }

      return deps.jsonOk(await deps.buildExportStatusPayload(record, deps.createDownloadUrl));
    } catch (_error) {
      return deps.jsonError("Failed to fetch export status", 500);
    } finally {
      client.release();
    }
  };
}
