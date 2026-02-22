import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { createDownloadUrl } from "@/lib/storage";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ id: string; exportId: string }>;
};

type ExportRow = {
  id: string;
  generated_document_id: string;
  format: "docx" | "pdf";
  status: "queued" | "processing" | "completed" | "failed";
  storage_key: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
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
    const exportResult = await client.query<ExportRow>(
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

    let downloadUrl: string | null = null;
    if (record.status === "completed" && record.storage_key) {
      const fileName = `unity-appeals-${record.generated_document_id}.${record.format}`;
      downloadUrl = await createDownloadUrl({
        key: record.storage_key,
        fileName,
        expiresInSeconds: 900,
      });
    }

    return jsonOk({
      exportId: record.id,
      documentId: record.generated_document_id,
      format: record.format,
      status: record.status,
      errorMessage: record.error_message,
      storageKey: record.storage_key,
      downloadUrl,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    });
  } catch (error) {
    console.error("GET /api/documents/:id/export/:exportId failed", error);
    return jsonError("Failed to fetch export status", 500);
  } finally {
    client.release();
  }
}
