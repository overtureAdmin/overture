import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";

type ReviseBody = {
  revisionPrompt: string;
};

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const body = await parseJsonBody<ReviseBody>(request);
  if (!body || !body.revisionPrompt?.trim()) {
    return jsonError("Missing required field: revisionPrompt", 422);
  }

  const { id } = await params;
  return jsonOk({
    documentId: id,
    status: "revised",
    updatedAt: new Date().toISOString(),
  });
}
