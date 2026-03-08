import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { createDocumentExportHandler } from "@/lib/api-handlers/document-export";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const handleDocumentExport = createDocumentExportHandler({
  getAuthContext: getAuthContextOrDevFallback,
  authRequiredResponse,
  parseJsonBody,
  jsonError,
  jsonOk,
  getDbPool,
  ensureTenantAndUser: async (db, auth) => ensureTenantAndUser(db as never, auth as never),
  insertAuditEvent: async (db, params) => insertAuditEvent(db as never, params),
});

export async function POST(request: Request, ctx: RouteParams) {
  return handleDocumentExport(request, ctx);
}
