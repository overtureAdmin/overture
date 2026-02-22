import { getDbPool } from "@/lib/db";
import { processOneQueuedExportAcrossTenants } from "@/lib/export-jobs";
import { processExportQueue } from "@/lib/export-processing";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { isValidExportProcessorToken } from "@/lib/internal-auth";

type ProcessBody = {
  limit?: number;
};

export async function POST(request: Request) {
  if (!isValidExportProcessorToken(request)) {
    return jsonError("Unauthorized", 401);
  }

  const body = (await parseJsonBody<ProcessBody>(request)) ?? {};
  const requestedLimit = body.limit ?? 5;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 25)
    : 5;

  const db = getDbPool();
  const client = await db.connect();
  try {
    const queueResult = await processExportQueue({
      limit,
      processOne: async () => processOneQueuedExportAcrossTenants({ client }),
    });
    return jsonOk(queueResult);
  } catch (error) {
    console.error("POST /api/internal/exports/process failed", error);
    return jsonError("Failed to process export queue", 500);
  } finally {
    client.release();
  }
}
