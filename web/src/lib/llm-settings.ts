type SqlClient = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type LlmReference = {
  id: string;
  referenceKind: "link" | "document";
  title: string;
  referenceValue: string;
  usageNote: string;
  sortOrder: number;
};

export type LlmPromptContext = {
  masterPrompt: string | null;
  userPrompt: string | null;
  references: LlmReference[];
  composedSystemPrompt: string;
};

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isMissingRelationError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

function isLlmSchemaFallbackError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  // 42501 = insufficient_privilege. Treat permission drift like missing tables
  // so runtime can continue with baseline prompt behavior.
  return isMissingRelationError(error) || code === "42501";
}

function buildReferenceBlock(references: LlmReference[]): string {
  if (references.length === 0) {
    return "";
  }
  const lines = references.map((reference, index) => {
    const prefix = `${index + 1}. ${reference.title} (${reference.referenceKind})`;
    return `${prefix}\n   Source: ${reference.referenceValue}\n   Use when: ${reference.usageNote}`;
  });
  return `User-curated references and usage guidance:\n${lines.join("\n")}\nAlways prioritize these references when relevant to the request.`;
}

export async function resolveLlmPromptContext(params: {
  db: SqlClient;
  organizationId: string;
  authSubject: string;
  fallbackSystemPrompt: string;
}): Promise<LlmPromptContext> {
  const { db, organizationId, authSubject, fallbackSystemPrompt } = params;
  const fallbackNormalized = normalizeWhitespace(fallbackSystemPrompt);

  try {
    const [masterResult, userResult, referencesResult] = await Promise.all([
      db.query<{ prompt: string }>(
        `
          SELECT prompt
          FROM llm_master_prompt
          WHERE id = 1
          LIMIT 1
        `,
      ),
      db.query<{ prompt: string }>(
        `
          SELECT prompt
          FROM llm_user_prompt
          WHERE organization_id = $1::uuid
            AND auth_subject = $2
          LIMIT 1
        `,
        [organizationId, authSubject],
      ),
      db.query<{
        id: string;
        reference_kind: "link" | "document";
        title: string;
        reference_value: string;
        usage_note: string;
        sort_order: number;
      }>(
        `
          SELECT id, reference_kind, title, reference_value, usage_note, sort_order
          FROM llm_user_reference
          WHERE organization_id = $1::uuid
            AND auth_subject = $2
          ORDER BY sort_order ASC, created_at ASC
          LIMIT 100
        `,
        [organizationId, authSubject],
      ),
    ]);

    const masterPrompt = masterResult.rows[0]?.prompt?.trim() || null;
    const userPrompt = userResult.rows[0]?.prompt?.trim() || null;
    const references: LlmReference[] = referencesResult.rows.map((row) => ({
      id: row.id,
      referenceKind: row.reference_kind,
      title: row.title,
      referenceValue: row.reference_value,
      usageNote: row.usage_note,
      sortOrder: row.sort_order,
    }));

    const segments = [fallbackNormalized];
    if (masterPrompt) {
      segments.push(`Master system guidance:\n${normalizeWhitespace(masterPrompt)}`);
    }
    if (userPrompt) {
      segments.push(`User system guidance:\n${normalizeWhitespace(userPrompt)}`);
    }
    const referenceBlock = buildReferenceBlock(references);
    if (referenceBlock) {
      segments.push(referenceBlock);
    }

    return {
      masterPrompt,
      userPrompt,
      references,
      composedSystemPrompt: normalizeWhitespace(segments.filter(Boolean).join("\n\n")),
    };
  } catch (error) {
    if (isLlmSchemaFallbackError(error)) {
      return {
        masterPrompt: null,
        userPrompt: null,
        references: [],
        composedSystemPrompt: fallbackNormalized,
      };
    }
    throw error;
  }
}

export async function getMasterPrompt(db: SqlClient): Promise<string | null> {
  try {
    const result = await db.query<{ prompt: string }>(
      `
        SELECT prompt
        FROM llm_master_prompt
        WHERE id = 1
        LIMIT 1
      `,
    );
    return result.rows[0]?.prompt ?? null;
  } catch (error) {
    if (isLlmSchemaFallbackError(error)) {
      return null;
    }
    throw error;
  }
}
