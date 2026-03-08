import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { createThreadDocumentsHandler } from "@/lib/api-handlers/thread-documents";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ threadId: string }>;
};

const handleThreadDocuments = createThreadDocumentsHandler({
  getAuthContext: getAuthContextOrDevFallback,
  authRequiredResponse,
  jsonError,
  jsonOk,
  getDbPool,
  ensureTenantAndUser: async (db, auth) => ensureTenantAndUser(db as never, auth as never),
});

export async function GET(request: Request, ctx: RouteParams) {
  return handleThreadDocuments(request, ctx);
}
