import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { processOneQueuedExport } from "@/lib/export-jobs";
import { processExportQueue } from "@/lib/export-processing";
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
    const queueResult = await processExportQueue({
      limit,
      processOne: async () =>
        processOneQueuedExport({
        client,
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
      }),
    });
    return jsonOk(queueResult);
  } catch (error) {
    console.error("POST /api/exports/process failed", error);
    return jsonError("Failed to process export queue", 500);
  } finally {
    client.release();
  }
}
