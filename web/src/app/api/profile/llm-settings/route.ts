import { authRequiredResponse, getAuthContextOrDevFallback } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { getMasterPrompt, resolveLlmPromptContext, type LlmReference } from "@/lib/llm-settings";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type ReferenceInput = {
  id?: string;
  referenceKind?: "link" | "document";
  title?: string;
  referenceValue?: string;
  usageNote?: string;
  sortOrder?: number;
};

type LlmSettingsPatchBody = {
  systemPrompt?: string;
  references?: ReferenceInput[];
};

function sanitizeOptionalPrompt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 8000);
}

function sanitizeReference(input: ReferenceInput, index: number): Omit<LlmReference, "id"> {
  const referenceKind = input.referenceKind === "document" ? "document" : "link";
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 240) : "";
  const referenceValue = typeof input.referenceValue === "string" ? input.referenceValue.trim().slice(0, 2000) : "";
  const usageNote = typeof input.usageNote === "string" ? input.usageNote.trim().slice(0, 1200) : "";
  if (!title || !referenceValue || !usageNote) {
    throw new Error("Each reference requires title, value, and usage note.");
  }
  return {
    referenceKind,
    title,
    referenceValue,
    usageNote,
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : index,
  };
}

export async function GET(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const db = getDbPool();
  try {
    const actor = await ensureTenantAndUser(db, auth);
    const fallback = "You are Overture assistant. Keep responses concise, policy-aware, and non-PHI.";
    const promptContext = await resolveLlmPromptContext({
      db,
      organizationId: actor.organizationId,
      authSubject: auth.userSub,
      fallbackSystemPrompt: fallback,
    });
    const masterPrompt = await getMasterPrompt(db);

    return jsonOk({
      manageable: actor.organizationStatus !== "suspended",
      systemPrompt: promptContext.userPrompt,
      effectiveSystemPrompt: promptContext.composedSystemPrompt,
      masterPrompt,
      references: promptContext.references,
    });
  } catch (error) {
    console.error("GET /api/profile/llm-settings failed", error);
    return jsonError("Failed to load LLM settings", 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }
  const body = await parseJsonBody<LlmSettingsPatchBody>(request);
  if (!body) {
    return jsonError("Invalid JSON body", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const actor = await ensureTenantAndUser(client, auth);
    if (actor.organizationStatus === "suspended") {
      await client.query("ROLLBACK");
      return jsonError("LLM settings are locked for this account", 403);
    }

    if ("systemPrompt" in body) {
      const prompt = sanitizeOptionalPrompt(body.systemPrompt);
      if (prompt) {
        await client.query(
          `
            INSERT INTO llm_user_prompt (organization_id, auth_subject, prompt, updated_at)
            VALUES ($1::uuid, $2, $3, NOW())
            ON CONFLICT (organization_id, auth_subject)
            DO UPDATE SET prompt = EXCLUDED.prompt, updated_at = NOW()
          `,
          [actor.organizationId, auth.userSub, prompt],
        );
      } else {
        await client.query(
          `
            DELETE FROM llm_user_prompt
            WHERE organization_id = $1::uuid
              AND auth_subject = $2
          `,
          [actor.organizationId, auth.userSub],
        );
      }
    }

    if (Array.isArray(body.references)) {
      const normalized = body.references.map((reference, index) => sanitizeReference(reference, index));
      await client.query(
        `
          DELETE FROM llm_user_reference
          WHERE organization_id = $1::uuid
            AND auth_subject = $2
        `,
        [actor.organizationId, auth.userSub],
      );
      for (const reference of normalized) {
        await client.query(
          `
            INSERT INTO llm_user_reference (
              organization_id,
              auth_subject,
              reference_kind,
              title,
              reference_value,
              usage_note,
              sort_order,
              updated_at
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NOW())
          `,
          [
            actor.organizationId,
            auth.userSub,
            reference.referenceKind,
            reference.title,
            reference.referenceValue,
            reference.usageNote,
            reference.sortOrder,
          ],
        );
      }
    }

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "llm.settings.updated",
      entityType: "organization",
      entityId: actor.organizationId,
      metadata: {
        updatedPrompt: "systemPrompt" in body,
        referenceCount: Array.isArray(body.references) ? body.references.length : undefined,
      },
    });

    await client.query("COMMIT");
    return jsonOk({ updated: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/profile/llm-settings failed", error);
    return jsonError(error instanceof Error ? error.message : "Failed to save LLM settings", 500);
  } finally {
    client.release();
  }
}
