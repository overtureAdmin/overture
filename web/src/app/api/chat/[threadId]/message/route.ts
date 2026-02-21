import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";

type ChatMessageBody = {
  role: "user";
  content: string;
};

type RouteParams = {
  params: Promise<{ threadId: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const body = await parseJsonBody<ChatMessageBody>(request);
  if (!body || body.role !== "user" || !body.content?.trim()) {
    return jsonError("Missing required fields: role='user', content", 422);
  }

  const { threadId } = await params;
  return jsonOk(
    {
      threadId,
      userMessageId: `msg_${crypto.randomUUID()}`,
      assistantMessageId: `msg_${crypto.randomUUID()}`,
      assistantReply: "Stub response. Bedrock integration will be added next.",
      citations: [],
    },
    201,
  );
}
