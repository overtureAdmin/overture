import { getAuthContextOrDevFallback, authRequiredResponse } from "@/lib/auth";
import { generateTextWithBedrock, getBedrockModelId } from "@/lib/bedrock";
import { getDbPool } from "@/lib/db";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";
import { ensureTenantAndUser, insertAuditEvent } from "@/lib/tenant-context";

type ChatMessageBody = {
  role: "user";
  content: string;
};

type RouteParams = {
  params: Promise<{ threadId: string }>;
};

function buildChatPrompt(messages: Array<{ role: string; content: string }>): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await getAuthContextOrDevFallback(request);
  if (!auth) {
    return authRequiredResponse();
  }

  const body = await parseJsonBody<ChatMessageBody>(request);
  if (!body || body.role !== "user" || !body.content?.trim()) {
    return jsonError("Missing required fields: role='user', content", 422);
  }

  const db = getDbPool();
  const client = await db.connect();
  const { threadId } = await params;
  try {
    await client.query("BEGIN");

    const actor = await ensureTenantAndUser(client, auth);

    const threadResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM thread
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
        LIMIT 1
      `,
      [threadId, actor.tenantId],
    );

    if (!threadResult.rows[0]?.id) {
      await client.query("ROLLBACK");
      return jsonError("Thread not found", 404);
    }

    const userMessageResult = await client.query<{ id: string }>(
      `
        INSERT INTO message (tenant_id, thread_id, user_id, role, content)
        VALUES ($1::uuid, $2::uuid, $3::uuid, 'user', $4)
        RETURNING id
      `,
      [actor.tenantId, threadId, actor.userId, body.content.trim()],
    );

    const promptMessagesResult = await client.query<{ role: string; content: string }>(
      `
        SELECT role, content
        FROM message
        WHERE tenant_id = $1::uuid
          AND thread_id = $2::uuid
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [actor.tenantId, threadId],
    );

    const assistantReply = await generateTextWithBedrock({
      systemPrompt:
        "You are Unity Appeals assistant. Help draft prior-authorization appeals clearly and conservatively. PHI processing is disabled, so avoid patient-identifying details.",
      userPrompt: buildChatPrompt([...promptMessagesResult.rows].reverse()),
      temperature: 0.2,
    });

    const assistantMessageResult = await client.query<{ id: string }>(
      `
        INSERT INTO message (tenant_id, thread_id, role, content, citations)
        VALUES ($1::uuid, $2::uuid, 'assistant', $3, '[]'::jsonb)
        RETURNING id
      `,
      [actor.tenantId, threadId, assistantReply],
    );

    await client.query(
      `
        UPDATE thread
        SET updated_at = NOW()
        WHERE id = $1::uuid
          AND tenant_id = $2::uuid
      `,
      [threadId, actor.tenantId],
    );

    await insertAuditEvent(client, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "message.create",
      entityType: "thread",
      entityId: threadId,
      metadata: {
        userMessageId: userMessageResult.rows[0].id,
        assistantMessageId: assistantMessageResult.rows[0].id,
        modelId: getBedrockModelId(),
        phiProcessingEnabled: false,
      },
    });

    await client.query("COMMIT");
    return jsonOk(
      {
        threadId,
        userMessageId: userMessageResult.rows[0].id,
        assistantMessageId: assistantMessageResult.rows[0].id,
        assistantReply,
        citations: [],
      },
      201,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/chat/:threadId/message failed", error);
    return jsonError("Failed to create message", 500);
  } finally {
    client.release();
  }
}
