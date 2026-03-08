import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { createDocumentExportStatusHandler } from "@/lib/api-handlers/document-export-status";
import { getDbPool } from "@/lib/db";
import { buildExportStatusPayload } from "@/lib/export-status";
import { jsonError, jsonOk } from "@/lib/http";
import { createDownloadUrl } from "@/lib/storage";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ id: string; exportId: string }>;
};

const handleDocumentExportStatus = createDocumentExportStatusHandler({
  getAuthContext: getAuthContextOrDevFallback,
  authRequiredResponse,
  jsonError,
  jsonOk,
  getDbPool,
  ensureTenantAndUser: async (db, auth) => ensureTenantAndUser(db as never, auth as never),
  buildExportStatusPayload,
  createDownloadUrl,
});

export async function GET(request: Request, ctx: RouteParams) {
  return handleDocumentExportStatus(request, ctx);
}
