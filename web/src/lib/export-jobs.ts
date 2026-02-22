import { PoolClient } from "pg";
import { buildExportArtifact } from "@/lib/export-artifacts";
import { uploadDocumentArtifact } from "@/lib/storage";
import { insertAuditEvent } from "@/lib/tenant-context";

type ClaimedExportJob = {
  export_id: string;
  generated_document_id: string;
  format: "docx" | "pdf";
  content: string;
  kind: "lmn" | "appeal" | "p2p";
  version: number;
};

export type ProcessExportResult =
  | { outcome: "none" }
  | { outcome: "completed"; exportId: string; storageKey: string }
  | { outcome: "failed"; exportId: string; reason: string };

async function claimNextQueuedExport(
  client: PoolClient,
  tenantId: string,
): Promise<ClaimedExportJob | null> {
  const result = await client.query<ClaimedExportJob>(
    `
      WITH candidate AS (
        SELECT gde.id
        FROM generated_document_export gde
        WHERE gde.tenant_id = $1::uuid
          AND gde.status = 'queued'
        ORDER BY gde.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ),
      claimed AS (
        UPDATE generated_document_export gde
        SET status = 'processing', updated_at = NOW()
        FROM candidate
        WHERE gde.id = candidate.id
        RETURNING gde.id AS export_id, gde.generated_document_id, gde.format
      )
      SELECT
        claimed.export_id,
        claimed.generated_document_id,
        claimed.format,
        gd.content,
        gd.kind,
        gd.version
      FROM claimed
      JOIN generated_document gd ON gd.id = claimed.generated_document_id
    `,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function processOneQueuedExport(params: {
  client: PoolClient;
  tenantId: string;
  actorUserId: string;
}): Promise<ProcessExportResult> {
  await params.client.query("BEGIN");
  const claimed = await claimNextQueuedExport(params.client, params.tenantId);
  if (!claimed) {
    await params.client.query("COMMIT");
    return { outcome: "none" };
  }
  await params.client.query("COMMIT");

  try {
    const artifact = await buildExportArtifact({
      format: claimed.format,
      content: claimed.content,
    });
    const storageKey = `exports/${params.tenantId}/${claimed.generated_document_id}/${claimed.export_id}.${artifact.extension}`;

    await uploadDocumentArtifact({
      key: storageKey,
      body: artifact.bytes,
      contentType: artifact.contentType,
    });

    await params.client.query("BEGIN");
    await params.client.query(
      `
        UPDATE generated_document_export
        SET status = 'completed',
            storage_key = $3,
            error_message = NULL,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
      `,
      [claimed.export_id, params.tenantId, storageKey],
    );
    await insertAuditEvent(params.client, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: "document.export.completed",
      entityType: "generated_document",
      entityId: claimed.generated_document_id,
      metadata: {
        exportId: claimed.export_id,
        format: claimed.format,
        kind: claimed.kind,
        version: claimed.version,
        storageKey,
      },
    });
    await params.client.query("COMMIT");
    return { outcome: "completed", exportId: claimed.export_id, storageKey };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown export error";
    await params.client.query("BEGIN");
    await params.client.query(
      `
        UPDATE generated_document_export
        SET status = 'failed',
            error_message = $3,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
      `,
      [claimed.export_id, params.tenantId, reason.slice(0, 500)],
    );
    await insertAuditEvent(params.client, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: "document.export.failed",
      entityType: "generated_document",
      entityId: claimed.generated_document_id,
      metadata: {
        exportId: claimed.export_id,
        format: claimed.format,
        reason,
      },
    });
    await params.client.query("COMMIT");
    return { outcome: "failed", exportId: claimed.export_id, reason };
  }
}
