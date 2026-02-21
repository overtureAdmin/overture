import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";

type ExportBody = {
  format: "docx" | "pdf";
};

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const body = await parseJsonBody<ExportBody>(request);
  if (!body || !["docx", "pdf"].includes(body.format)) {
    return jsonError("Missing required field: format (docx|pdf)", 422);
  }

  const { id } = await params;
  return jsonOk({
    documentId: id,
    format: body.format,
    exportId: `exp_${crypto.randomUUID()}`,
    status: "queued",
  });
}
