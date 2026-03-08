import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { createDocumentDetailHandler } from "@/lib/api-handlers/document-detail";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const handleDocumentDetail = createDocumentDetailHandler({
  getAuthContext: getAuthContextOrDevFallback,
  authRequiredResponse,
  jsonError,
  jsonOk,
  getDbPool,
  ensureTenantAndUser: async (db, auth) => ensureTenantAndUser(db as never, auth as never),
});

export async function GET(request: Request, ctx: RouteParams) {
  return handleDocumentDetail(request, ctx);
}
