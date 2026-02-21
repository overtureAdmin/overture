import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";

type GenerateBody = {
  kind: "lmn" | "appeal" | "p2p";
  instructions?: string;
};

type RouteParams = {
  params: Promise<{ threadId: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const body = await parseJsonBody<GenerateBody>(request);
  if (!body || !["lmn", "appeal", "p2p"].includes(body.kind)) {
    return jsonError("Missing required field: kind (lmn|appeal|p2p)", 422);
  }

  const { threadId } = await params;
  return jsonOk(
    {
      threadId,
      documentId: `doc_${crypto.randomUUID()}`,
      kind: body.kind,
      status: "draft_ready",
    },
    201,
  );
}
