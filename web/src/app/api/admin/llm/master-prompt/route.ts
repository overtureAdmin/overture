import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { getMasterPrompt } from "@/lib/llm-settings";
import { isUnitySuperAdmin } from "@/lib/super-admin";

type MasterPromptBody = {
  prompt?: string;
};

function sanitizePrompt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 12000);
}

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const db = getDbPool();
  try {
    const prompt = await getMasterPrompt(db);
    return jsonOk({
      prompt:
        prompt ??
        "You are Overture assistant. Produce concise, clinically grounded, policy-aware prior-authorization appeal content. PHI processing is disabled: never include patient-identifying details.",
    });
  } catch (error) {
    console.error("GET /api/admin/llm/master-prompt failed", error);
    return jsonError("Failed to load master prompt", 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  if (!isUnitySuperAdmin(auth)) {
    return jsonError("Forbidden", 403);
  }

  const body = await parseJsonBody<MasterPromptBody>(request);
  const prompt = sanitizePrompt(body?.prompt);
  if (!prompt) {
    return jsonError("Prompt is required", 422);
  }

  const db = getDbPool();
  try {
    await db.query(
      `
        INSERT INTO llm_master_prompt (id, prompt, updated_by_subject, updated_at)
        VALUES (1, $1, $2, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          prompt = EXCLUDED.prompt,
          updated_by_subject = EXCLUDED.updated_by_subject,
          updated_at = NOW()
      `,
      [prompt, auth.userSub],
    );
    return jsonOk({ updated: true });
  } catch (error) {
    console.error("PATCH /api/admin/llm/master-prompt failed", error);
    return jsonError("Failed to update master prompt", 500);
  }
}
