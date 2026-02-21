import { jsonError, jsonOk, parseJsonBody } from "@/lib/http";

type CompleteUploadBody = {
  uploadId: string;
  storageKey: string;
  checksum?: string;
};

export async function POST(request: Request) {
  const body = await parseJsonBody<CompleteUploadBody>(request);
  if (!body || !body.uploadId || !body.storageKey) {
    return jsonError("Missing required fields: uploadId, storageKey", 422);
  }

  return jsonOk(
    {
      uploadId: body.uploadId,
      sourceDocumentId: `src_${crypto.randomUUID()}`,
      ingestionStatus: "queued",
    },
    201,
  );
}
