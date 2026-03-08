import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { createThreadWorkflowHandler } from "@/lib/api-handlers/thread-workflow";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ threadId: string }>;
};

const handleThreadWorkflow = createThreadWorkflowHandler({
  getAuthContext: getAuthContextOrDevFallback,
  authRequiredResponse,
  jsonError,
  jsonOk,
  getDbPool,
  ensureTenantAndUser: async (db, auth) => ensureTenantAndUser(db as never, auth as never),
});

export async function GET(request: Request, ctx: RouteParams) {
  return handleThreadWorkflow(request, ctx);
}
