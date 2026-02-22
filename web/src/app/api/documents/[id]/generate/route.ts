import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import {
  BedrockGuardrailError,
  findPhiFindings,
  generateTextWithBedrock,
  getBedrockModelId,
} from "@/lib/bedrock";
import { getDbPool } from "@/lib/db";
import { createDocumentGenerateHandler } from "@/lib/api-handlers/document-generate";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const handleDocumentGenerate = createDocumentGenerateHandler({
  getAuthContext: getAuthContextOrDevFallback,
  authRequiredResponse,
  parseJsonBody,
  jsonError,
  jsonOk,
  findPhiFindings,
  generateTextWithBedrock,
  getBedrockModelId,
  isBedrockGuardrailError: (error): error is BedrockGuardrailError => error instanceof BedrockGuardrailError,
  getDbPool,
  ensureTenantAndUser: async (db, auth) => ensureTenantAndUser(db as never, auth),
  insertAuditEvent: async (db, params) => insertAuditEvent(db as never, params),
});

export async function POST(request: Request, ctx: RouteParams) {
  return handleDocumentGenerate(request, ctx);
}
