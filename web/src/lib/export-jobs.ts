import { PoolClient } from "pg";
import { buildExportArtifact } from "@/lib/export-artifacts";
import { uploadDocumentArtifact } from "@/lib/storage";
import { insertAuditEvent } from "@/lib/tenant-context";

type ClaimedExportJob = {
  export_id: string;
  tenant_id: string;
  generated_document_id: string;
  requested_by_user_id: string | null;
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
        RETURNING gde.id AS export_id, gde.tenant_id, gde.generated_document_id, gde.requested_by_user_id, gde.format
      )
      SELECT
        claimed.export_id,
        claimed.tenant_id,
        claimed.generated_document_id,
        claimed.requested_by_user_id,
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

async function claimNextQueuedExportAnyTenant(client: PoolClient): Promise<ClaimedExportJob | null> {
  const result = await client.query<ClaimedExportJob>(
    `
      WITH candidate AS (
        SELECT gde.id
        FROM generated_document_export gde
        WHERE gde.status = 'queued'
        ORDER BY gde.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ),
      claimed AS (
        UPDATE generated_document_export gde
        SET status = 'processing', updated_at = NOW()
        FROM candidate
        WHERE gde.id = candidate.id
        RETURNING gde.id AS export_id, gde.tenant_id, gde.generated_document_id, gde.requested_by_user_id, gde.format
      )
      SELECT
        claimed.export_id,
        claimed.tenant_id,
        claimed.generated_document_id,
        claimed.requested_by_user_id,
        claimed.format,
        gd.content,
        gd.kind,
        gd.version
      FROM claimed
      JOIN generated_document gd ON gd.id = claimed.generated_document_id
    `,
  );
  return result.rows[0] ?? null;
}

export async function processOneQueuedExport(params: {
  client: PoolClient;
  tenantId: string;
  actorUserId: string;
}): Promise<ProcessExportResult> {
  return processOneClaimedExport(params.client, await claimQueuedExportForTenant(params.client, params.tenantId), {
    tenantId: params.tenantId,
    actorUserId: params.actorUserId,
  });
}

async function claimQueuedExportForTenant(client: PoolClient, tenantId: string): Promise<ClaimedExportJob | null> {
  await client.query("BEGIN");
  const claimed = await claimNextQueuedExport(client, tenantId);
  if (!claimed) {
    await client.query("COMMIT");
    return null;
  }
  await client.query("COMMIT");
  return claimed;
}

async function claimQueuedExportAcrossTenants(client: PoolClient): Promise<ClaimedExportJob | null> {
  await client.query("BEGIN");
  const claimed = await claimNextQueuedExportAnyTenant(client);
  if (!claimed) {
    await client.query("COMMIT");
    return null;
  }
  await client.query("COMMIT");
  return claimed;
}

async function processOneClaimedExport(
  client: PoolClient,
  claimed: ClaimedExportJob | null,
  actor: { tenantId: string; actorUserId: string | null },
): Promise<ProcessExportResult> {
  if (!claimed) {
    return { outcome: "none" };
  }

  try {
    const artifact = await buildExportArtifact({
      format: claimed.format,
      content: claimed.content,
    });
    const storageKey = `exports/${actor.tenantId}/${claimed.generated_document_id}/${claimed.export_id}.${artifact.extension}`;

    await uploadDocumentArtifact({
      key: storageKey,
      body: artifact.bytes,
      contentType: artifact.contentType,
    });

    await client.query("BEGIN");
    await client.query(
      `
        UPDATE generated_document_export
        SET status = 'completed',
            storage_key = $3,
            error_message = NULL,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
      `,
      [claimed.export_id, actor.tenantId, storageKey],
    );
    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.actorUserId,
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
    await client.query("COMMIT");
    return { outcome: "completed", exportId: claimed.export_id, storageKey };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown export error";
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE generated_document_export
        SET status = 'failed',
            error_message = $3,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
      `,
      [claimed.export_id, actor.tenantId, reason.slice(0, 500)],
    );
    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.actorUserId,
      action: "document.export.failed",
      entityType: "generated_document",
      entityId: claimed.generated_document_id,
      metadata: {
        exportId: claimed.export_id,
        format: claimed.format,
        reason,
      },
    });
    await client.query("COMMIT");
    return { outcome: "failed", exportId: claimed.export_id, reason };
  }
}

export async function processOneQueuedExportAcrossTenants(params: {
  client: PoolClient;
}): Promise<ProcessExportResult> {
  const claimed = await claimQueuedExportAcrossTenants(params.client);
  return processOneClaimedExport(params.client, claimed, {
    tenantId: claimed?.tenant_id ?? "",
    actorUserId: claimed?.requested_by_user_id ?? null,
  });
}
