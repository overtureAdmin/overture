import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { buildExportStatusPayload, ExportStatusRecord } from "@/lib/export-status";
import { jsonError, jsonOk } from "@/lib/http";
import { createDownloadUrl } from "@/lib/storage";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ id: string; exportId: string }>;
};

export async function GET(request: Request, { params }: RouteParams) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const { id, exportId } = await params;
  const db = getDbPool();
  const client = await db.connect();

  try {
    const actor = await ensureTenantAndUser(client, auth);
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
      return jsonError("Export not found", 404);
    }

    return jsonOk(await buildExportStatusPayload(record, createDownloadUrl));
  } catch (error) {
    console.error("GET /api/documents/:id/export/:exportId failed", error);
    return jsonError("Failed to fetch export status", 500);
  } finally {
    client.release();
  }
}
