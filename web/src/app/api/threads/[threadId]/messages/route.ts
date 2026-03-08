import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { createThreadMessagesHandler } from "@/lib/api-handlers/thread-messages";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureTenantAndUser } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ threadId: string }>;
};

const handleThreadMessages = createThreadMessagesHandler({
  getAuthContext: getAuthContextOrDevFallback,
  authRequiredResponse,
  jsonError,
  jsonOk,
  getDbPool,
  ensureTenantAndUser: async (db, auth) => ensureTenantAndUser(db as never, auth as never),
});

export async function GET(request: Request, ctx: RouteParams) {
  return handleThreadMessages(request, ctx);
}
