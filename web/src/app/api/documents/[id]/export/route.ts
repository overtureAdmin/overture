import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type ExportBody = {
  format: "docx" | "pdf";
};

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<ExportBody>(request);
  if (!body || !["docx", "pdf"].includes(body.format)) {
    return jsonError("Missing required field: format (docx|pdf)", 422);
  }

  const format = body.format;
  const { id } = await params;
  const db = getDbPool();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);

    const documentResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM generated_document
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
        LIMIT 1
      `,
      [id, actor.tenantId],
    );
    if (!documentResult.rows[0]?.id) {
      await client.query("ROLLBACK");
      return jsonError("Document not found", 404);
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

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "document.export.requested",
      entityType: "generated_document",
      entityId: id,
      metadata: {
        exportId: exportRecord.id,
        format,
        status: exportRecord.status,
      },
    });

    await client.query("COMMIT");
    return jsonOk(
      {
        documentId: id,
        format,
        exportId: exportRecord.id,
        status: exportRecord.status,
        createdAt: exportRecord.created_at,
      },
      201,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/documents/:id/export failed", error);
    return jsonError("Failed to queue export", 500);
  } finally {
    client.release();
  }
}
