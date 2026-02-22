import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { processOneQueuedExport } from "@/lib/export-jobs";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type ProcessBody = {
  limit?: number;
};

export async function POST(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = (await parseJsonBody<ProcessBody>(request)) ?? {};
  const requestedLimit = body.limit ?? 1;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 10)
    : 1;

  const db = getDbPool();
  const client = await db.connect();
  try {
    const actor = await ensureTenantAndUser(client, auth);
    const processed: Array<{ exportId: string; outcome: string; storageKey?: string; reason?: string }> = [];

    for (let i = 0; i < limit; i += 1) {
      const result = await processOneQueuedExport({
        client,
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
      });
      if (result.outcome === "none") {
        break;
      }
      if (result.outcome === "completed") {
        processed.push({
          exportId: result.exportId,
          outcome: result.outcome,
          storageKey: result.storageKey,
        });
      } else {
        processed.push({
          exportId: result.exportId,
          outcome: result.outcome,
          reason: result.reason,
        });
      }
    }

    return jsonOk({
      requestedLimit: limit,
      processedCount: processed.length,
      processed,
    });
  } catch (error) {
    console.error("POST /api/exports/process failed", error);
    return jsonError("Failed to process export queue", 500);
  } finally {
    client.release();
  }
}
