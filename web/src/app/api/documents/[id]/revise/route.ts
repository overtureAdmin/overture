import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import {
  BedrockGuardrailError,
  findPhiFindings,
  generateTextWithBedrock,
  getBedrockModelId,
} from "@/lib/bedrock";
import { createDocumentReviseHandler } from "@/lib/api-handlers/document-revise";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";
import { resolveLlmPromptContext } from "@/lib/llm-settings";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const handleDocumentRevise = createDocumentReviseHandler({
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
  ensureTenantAndUser: async (db, auth) => ensureTenantAndUser(db as never, auth as never),
  insertAuditEvent: async (db, params) => insertAuditEvent(db as never, params),
  resolvePromptContext: ({ db, organizationId, authSubject, fallbackSystemPrompt }) =>
    resolveLlmPromptContext({ db, organizationId, authSubject, fallbackSystemPrompt }),
});

export async function POST(request: Request, ctx: RouteParams) {
  return handleDocumentRevise(request, ctx);
}
